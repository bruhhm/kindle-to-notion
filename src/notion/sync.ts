import { Client, isFullPage } from '@notionhq/client';
import { MergedBookData, SyncStats, KindleHighlight } from '../types.js';

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

  private truncate(str: string, maxLength: number = 2000): string {
    return str.length > maxLength ? str.substring(0, maxLength - 3) + '...' : str;
  }

  /**
   * Fetches all existing books from Notion database indexed by ASIN.
   */
  async getExistingBooks(): Promise<Map<string, { pageId: string; currentStatus?: string; currentRating?: number }>> {
    const map = new Map<string, { pageId: string; currentStatus?: string; currentRating?: number }>();
    let cursor: string | undefined = undefined;

    do {
      const response = await this.notion.databases.query({
        database_id: this.booksDatabaseId,
        start_cursor: cursor
      });

      for (const page of response.results) {
        if (isFullPage(page)) {
          const asinProp = page.properties['ASIN'];
          const statusProp = page.properties['Status'];
          const ratingProp = page.properties['Rating'];

          let asinValue = '';
          if (asinProp && asinProp.type === 'rich_text' && asinProp.rich_text.length > 0) {
            asinValue = asinProp.rich_text[0].plain_text.trim();
          }

          let statusValue: string | undefined = undefined;
          if (statusProp && statusProp.type === 'select' && statusProp.select) {
            statusValue = statusProp.select.name;
          }

          let ratingValue: number | undefined = undefined;
          if (ratingProp && ratingProp.type === 'number' && ratingProp.number !== null) {
            ratingValue = ratingProp.number;
          }

          if (asinValue) {
            map.set(asinValue, { pageId: page.id, currentStatus: statusValue, currentRating: ratingValue });
          }
        }
      }

      cursor = response.has_more ? response.next_cursor || undefined : undefined;
    } while (cursor);

    return map;
  }

  /**
   * Fetches all existing highlight Hash IDs to guarantee deduplication.
   */
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

    console.log(`Found ${existingBooks.size} existing books and ${existingHighlightHashes.size} existing highlights in Notion.`);

    for (const book of books) {
      try {
        let bookPageId: string;
        const existingBook = existingBooks.get(book.asin);

        if (!existingBook) {
          // Create new Book in Notion
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
            'ASIN': {
              rich_text: [{ text: { content: book.asin } }]
            },
            'Total Highlights': {
              number: book.highlights.length
            },
            'Last Synced': {
              date: { start: new Date().toISOString() }
            }
          };

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

          if (book.genres.length > 0) {
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
          stats.booksCreated++;
          console.log(`Created Notion book page for "${book.title}".`);
        } else {
          bookPageId = existingBook.pageId;

          // Selective update: preserve manual user status/rating if edited in Notion
          const updateProperties: Record<string, any> = {
            'Total Highlights': {
              number: book.highlights.length
            },
            'Last Synced': {
              date: { start: new Date().toISOString() }
            }
          };

          // If status not manually set in Notion, sync it
          if (!existingBook.currentStatus) {
            updateProperties['Status'] = { select: { name: book.status } };
          }

          if (existingBook.currentRating === undefined && book.rating !== undefined) {
            updateProperties['Rating'] = { number: book.rating };
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
            'Type': {
              select: { name: hl.type }
            },
            'Hash ID': {
              rich_text: [{ text: { content: hl.id } }]
            },
            'Book': {
              relation: [{ id: bookPageId }]
            }
          };

          if (hl.note) {
            highlightProps['Note'] = {
              rich_text: [{ text: { content: this.truncate(hl.note, 1900) } }]
            };
          }

          if (hl.location) {
            highlightProps['Location'] = {
              rich_text: [{ text: { content: hl.location } }]
            };
          }

          if (hl.dateAdded) {
            highlightProps['Date Added'] = {
              date: { start: hl.dateAdded }
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
        const errorMsg = `Error syncing book "${book.title}": ${(err as Error).message}`;
        console.error(errorMsg);
        stats.errors.push(errorMsg);
      }
    }

    return stats;
  }
}
