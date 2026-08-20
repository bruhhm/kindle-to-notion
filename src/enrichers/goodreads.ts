import Parser from 'rss-parser';
import { GoodreadsData, ReadingStatus } from '../types.js';
import { normalizeTitle } from '../utils/hash.js';

export interface FullGoodreadsBook {
  bookId: string;
  title: string;
  author: string;
  status: ReadingStatus;
  userRating?: number;
  dateRead?: string;
  userReview?: string;
  coverUrl?: string;
  summary?: string;
  isbn?: string;
}

export class GoodreadsEnricher {
  private userId: string;
  private parser: Parser;

  constructor(userId: string) {
    this.userId = userId;
    this.parser = new Parser({
      customFields: {
        item: [
          'author_name',
          'isbn',
          'user_rating',
          'user_read_at',
          'user_date_added',
          'user_shelves',
          'book_description',
          'book_large_image_url',
          'book_medium_image_url',
          'book_small_image_url',
          'book_id'
        ]
      }
    });
  }

  private isNonEnglish(text?: string): boolean {
    if (!text) return false;
    return /[\u0600-\u06FF\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\u0590-\u05FF]/.test(text);
  }

  private cleanHtml(html?: string): string | undefined {
    if (!html) return undefined;
    const cleaned = html.replace(/<[^>]*>?/gm, '').trim();
    if (!cleaned || this.isNonEnglish(cleaned)) {
      return undefined;
    }
    return cleaned;
  }

  async fetchAllBooks(): Promise<FullGoodreadsBook[]> {
    const booksMap = new Map<string, FullGoodreadsBook>();

    // Query specific shelves in order so specific statuses take precedence
    const shelfConfigs: Array<{ shelf: string; defaultStatus: ReadingStatus }> = [
      { shelf: 'read', defaultStatus: 'Read' },
      { shelf: 'currently-reading', defaultStatus: 'Currently Reading' },
      { shelf: 'to-read', defaultStatus: 'Want to Read' },
      { shelf: '#ALL#', defaultStatus: 'Want to Read' }
    ];

    for (const { shelf, defaultStatus } of shelfConfigs) {
      let page = 1;
      while (true) {
        try {
          const feedUrl = `https://www.goodreads.com/review/list_rss/${this.userId}?shelf=${encodeURIComponent(shelf)}&page=${page}`;
          console.log(`Fetching Goodreads shelf "${shelf}" (page ${page})...`);
          const feed = await this.parser.parseURL(feedUrl);

          if (!feed.items || feed.items.length === 0) break;

          for (const item of feed.items as any[]) {
            if (!item.title) continue;

            const normalized = normalizeTitle(item.title);
            const bookId = item.book_id || normalized;

            // Determine status accurately
            let status: ReadingStatus = defaultStatus;
            const shelvesList = (item.user_shelves || '')
              .toLowerCase()
              .split(',')
              .map((s: string) => s.trim());

            if (shelf === 'currently-reading' || shelvesList.includes('currently-reading')) {
              status = 'Currently Reading';
            } else if (shelf === 'read' || (shelvesList.includes('read') && !shelvesList.includes('to-read')) || item.user_read_at) {
              status = 'Read';
            } else if (shelf === 'to-read' || shelvesList.includes('to-read')) {
              status = 'Want to Read';
            }

            const rating = item.user_rating ? parseInt(item.user_rating, 10) : undefined;
            const rawCover = item.book_large_image_url || item.book_medium_image_url || item.book_small_image_url;
            let coverUrl: string | undefined = undefined;
            if (rawCover && !rawCover.includes('nophoto')) {
              coverUrl = rawCover.replace(/i\.gr-assets\.com/, 'images-na.ssl-images-amazon.com');
            }

            const key = bookId || normalized;
            const existing = booksMap.get(key) || Array.from(booksMap.values()).find(b => normalizeTitle(b.title) === normalized);

            if (existing) {
              // If we fetched from specific shelf 'read' or 'currently-reading', update status
              if (shelf === 'read' || shelf === 'currently-reading') {
                existing.status = status;
              }
              if (!existing.userRating && rating && rating > 0) {
                existing.userRating = rating;
              }
              if (!existing.coverUrl && coverUrl) {
                existing.coverUrl = coverUrl;
              }
            } else {
              booksMap.set(key, {
                bookId,
                title: item.title,
                author: item.author_name || 'Unknown Author',
                status,
                userRating: isNaN(rating || NaN) || rating === 0 ? undefined : rating,
                dateRead: item.user_read_at || undefined,
                userReview: this.cleanHtml(item.user_review),
                coverUrl,
                summary: this.cleanHtml(item.book_description),
                isbn: item.isbn || undefined
              });
            }
          }

          if (feed.items.length < 100) break;
          page++;
        } catch (err) {
          console.error(`Error fetching Goodreads shelf "${shelf}" page ${page}: ${(err as Error).message}`);
          break;
        }
      }
    }

    const allBooks = Array.from(booksMap.values());
    console.log(`Successfully parsed ${allBooks.length} total unique books from Goodreads.`);
    return allBooks;
  }
}
