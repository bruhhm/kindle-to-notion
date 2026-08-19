import { Client, isFullPage } from '@notionhq/client';
import { MergedBookData, KindleHighlight, SyncStats, ReadingStatus } from '../types.js';
import { normalizeTitle } from '../utils/hash.js';

export interface NotionSyncConfig {
  notion: Client;
  booksDatabaseId: string;
  highlightsDatabaseId: string;
}

export class NotionSyncEngine {
  private notion: Client;
  private booksDatabaseId: string;
  private highlightsDatabaseId: string;

  constructor(config: NotionSyncConfig) {
    this.notion = config.notion;
    this.booksDatabaseId = config.booksDatabaseId;
    this.highlightsDatabaseId = config.highlightsDatabaseId;
  }

  private truncate(str: string, maxLen: number): string {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen - 3) + '...' : str;
  }

  async getExistingBooks(): Promise<{ byAsin: Map<string, { pageId: string; currentStatus?: string; currentRating?: number }>; byTitle: Map<string, { pageId: string; currentStatus?: string; currentRating?: number }> }> {
    const byAsin = new Map<string, { pageId: string; currentStatus?: string; currentRating?: number }>();
    const byTitle = new Map<string, { pageId: string; currentStatus?: string; currentRating?: number }>();

    let cursor: string | undefined = undefined;

    do {
      const response = await this.notion.databases.query({
        database_id: this.booksDatabaseId,
        start_cursor: cursor
      });

      for (const page of response.results) {
        if (isFullPage(page)) {
          const titleProp = page.properties['Title'] || page.properties['Name'];
          let titleValue = '';
          if (titleProp && titleProp.type === 'title' && titleProp.title.length > 0) {
            titleValue = titleProp.title[0].plain_text.trim();
          }

          const asinProp = page.properties['ASIN'];
          let asinValue = '';
          if (asinProp && asinProp.type === 'rich_text' && asinProp.rich_text.length > 0) {
            asinValue = asinProp.rich_text[0].plain_text.trim();
          }

          const statusProp = page.properties['Status'];
          let statusValue: string | undefined = undefined;
          if (statusProp && statusProp.type === 'select' && statusProp.select) {
            statusValue = statusProp.select.name;
          }

          const ratingProp = page.properties['Rating'];
          let ratingValue: number | undefined = undefined;
          if (ratingProp && ratingProp.type === 'number' && ratingProp.number !== null) {
            ratingValue = ratingProp.number;
          }

          const record = { pageId: page.id, currentStatus: statusValue, currentRating: ratingValue };

          if (asinValue) {
            byAsin.set(asinValue, record);
          }
          if (titleValue) {
            byTitle.set(normalizeTitle(titleValue), record);
          }
        }
      }

      cursor = response.has_more ? response.next_cursor || undefined : undefined;
    } while (cursor);

    return { byAsin, byTitle };
  }

  async getExistingHighlightHashes(): Promise<Set<string>> {
    const hashes = new Set<string>();
    let cursor: string | undefined = undefined;

    do {
      const response = await this.notion.databases.query({
        database_id: this.highlightsDatabaseId,
        start_cursor: cursor
      });

      for (const page of response.results) {
        if (isFullPage(page)) {
          const hashProp = page.properties['Hash ID'];
          if (hashProp && hashProp.type === 'rich_text' && hashProp.rich_text.length > 0) {
            hashes.add(hashProp.rich_text[0].plain_text.trim());
          }
        }
      }

      cursor = response.has_more ? response.next_cursor || undefined : undefined;
    } while (cursor);

    return hashes;
  }

  async syncBook(
    book: MergedBookData,
    existingBooks: { byAsin: Map<string, any>; byTitle: Map<string, any> },
    existingHighlightHashes: Set<string>,
    stats: SyncStats
  ): Promise<void> {
    try {
      let bookPageId: string;
      const normalizedTitle = normalizeTitle(book.title);
      const existingBook = existingBooks.byAsin.get(book.asin) || existingBooks.byTitle.get(normalizedTitle);

      if (!existingBook) {
        const pageProperties: Record<string, any> = {
          'Title': {
            title: [{ text: { content: this.truncate(book.title, 200) } }]
          },
          'Author': {
            rich_text: [{ text: { content: this.truncate(book.author, 200) } }]
          },
          'Status': {
            select: { name: book.status }
          },
          'Total Highlights': {
            number: book.highlights.length
          },
          'Last Synced': {
            date: { start: new Date().toISOString() }
          }
        };

        if (book.asin) {
          pageProperties['ASIN'] = {
            rich_text: [{ text: { content: book.asin } }]
          };
        }

        if (book.summary) {
          pageProperties['Summary'] = {
            rich_text: [{ text: { content: this.truncate(book.summary, 1900) } }]
          };
        }

        if (book.isbn) {
          pageProperties['ISBN'] = {
            rich_text: [{ text: { content: book.isbn } }]
          };
        }

        if (book.pageCount) {
          pageProperties['Page Count'] = {
            number: book.pageCount
          };
        }

        if (book.rating) {
          pageProperties['Rating'] = {
            number: book.rating
          };
        }

        if (book.genres && book.genres.length > 0) {
          pageProperties['Genres'] = {
            multi_select: book.genres.slice(0, 5).map(g => ({ name: g.replace(/,/g, '').substring(0, 50) }))
          };
        }

        const newPage = await this.notion.pages.create({
          parent: { database_id: this.booksDatabaseId },
          cover: book.coverUrl ? { type: 'external', external: { url: book.coverUrl } } : undefined,
          properties: pageProperties
        });

        bookPageId = newPage.id;
        existingBooks.byTitle.set(normalizedTitle, { pageId: bookPageId, currentStatus: book.status, currentRating: book.rating });
        if (book.asin) {
          existingBooks.byAsin.set(book.asin, { pageId: bookPageId, currentStatus: book.status, currentRating: book.rating });
        }

        stats.booksCreated++;
      } else {
        bookPageId = existingBook.pageId;

        const updateProperties: Record<string, any> = {
          'Total Highlights': {
            number: book.highlights.length
          },
          'Last Synced': {
            date: { start: new Date().toISOString() }
          }
        };

        if (book.asin) {
          updateProperties['ASIN'] = {
            rich_text: [{ text: { content: book.asin } }]
          };
        }

        if (!existingBook.currentStatus) {
          updateProperties['Status'] = { select: { name: book.status } };
        }

        if (existingBook.currentRating === undefined && book.rating !== undefined) {
          updateProperties['Rating'] = { number: book.rating };
        }

        if (book.summary) {
          updateProperties['Summary'] = {
            rich_text: [{ text: { content: this.truncate(book.summary, 1900) } }]
          };
        }

        await this.notion.pages.update({
          page_id: bookPageId,
          cover: book.coverUrl ? { type: 'external', external: { url: book.coverUrl } } : undefined,
          properties: updateProperties
        });

        stats.booksUpdated++;
      }

      // Sync Highlights for this book
      for (const hl of book.highlights) {
        if (existingHighlightHashes.has(hl.id)) {
          stats.highlightsSkipped++;
          continue;
        }

        const previewTitle = this.truncate(hl.text, 80) || `Bookmark at ${hl.location || 'Unknown'}`;

        const highlightProps: Record<string, any> = {
          'Name': {
            title: [{ text: { content: previewTitle } }]
          },
          'Highlight Text': {
            rich_text: [{ text: { content: this.truncate(hl.text, 1900) } }]
          },
          'Book': {
            relation: [{ id: bookPageId }]
          },
          'Type': {
            select: { name: hl.type || 'Highlight' }
          },
          'Hash ID': {
            rich_text: [{ text: { content: hl.id } }]
          },
          'Date Added': {
            date: { start: new Date().toISOString() }
          }
        };

        if (hl.location) {
          highlightProps['Location'] = {
            rich_text: [{ text: { content: hl.location } }]
          };
        }

        if (hl.note) {
          highlightProps['Note'] = {
            rich_text: [{ text: { content: this.truncate(hl.note, 1900) } }]
          };
        }

        await this.notion.pages.create({
          parent: { database_id: this.highlightsDatabaseId },
          properties: highlightProps
        });

        existingHighlightHashes.add(hl.id);
        stats.highlightsCreated++;
      }
    } catch (err) {
      stats.errors.push(`Error syncing "${book.title}": ${(err as Error).message}`);
    }
  }

  async syncAll(books: MergedBookData[]): Promise<SyncStats> {
    const stats: SyncStats = {
      booksCreated: 0,
      booksUpdated: 0,
      highlightsCreated: 0,
      highlightsSkipped: 0,
      errors: []
    };

    console.log('Fetching existing Notion database state for deduplication...');
    const existingBooks = await this.getExistingBooks();
    const existingHighlightHashes = await this.getExistingHighlightHashes();

    console.log(`Found ${existingBooks.byTitle.size} existing books and ${existingHighlightHashes.size} existing highlights in Notion.`);

    // Process books in concurrent batches of 5
    const BATCH_SIZE = 5;
    for (let i = 0; i < books.length; i += BATCH_SIZE) {
      const batch = books.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(book => this.syncBook(book, existingBooks, existingHighlightHashes, stats)));
    }

    return stats;
  }
}
