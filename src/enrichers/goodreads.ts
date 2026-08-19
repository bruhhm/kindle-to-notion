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
    // Check for non-Latin writing systems (Arabic, Cyrillic, CJK, etc.)
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
    const books: FullGoodreadsBook[] = [];
    const seenTitles = new Set<string>();

    try {
      const feedUrl = `https://www.goodreads.com/review/list_rss/${this.userId}?shelf=%23ALL%23`;
      console.log(`Fetching full Goodreads library from ${feedUrl}...`);
      const feed = await this.parser.parseURL(feedUrl);

      for (const item of feed.items as any[]) {
        if (!item.title) continue;

        const normalized = normalizeTitle(item.title);
        if (seenTitles.has(normalized)) continue;
        seenTitles.add(normalized);

        let status: ReadingStatus = 'Want to Read';
        const shelf = (item.user_shelves || '').toLowerCase();
        if (shelf.includes('currently-reading')) {
          status = 'Currently Reading';
        } else if (shelf.includes('read') && !shelf.includes('to-read')) {
          status = 'Read';
        } else if (item.user_rating && parseInt(item.user_rating, 10) > 0) {
          status = 'Read';
        }

        const rating = item.user_rating ? parseInt(item.user_rating, 10) : undefined;
        const rawCover = item.book_large_image_url || item.book_medium_image_url || item.book_small_image_url;
        let coverUrl: string | undefined = undefined;
        if (rawCover && !rawCover.includes('nophoto')) {
          coverUrl = rawCover.replace(/i\.gr-assets\.com/, 'images-na.ssl-images-amazon.com');
        }

        books.push({
          bookId: item.book_id || normalized,
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

      console.log(`Successfully parsed ${books.length} total books from Goodreads.`);
    } catch (err) {
      console.error(`Error fetching Goodreads library: ${(err as Error).message}`);
    }

    return books;
  }
}
