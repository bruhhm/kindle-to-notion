import Parser from 'rss-parser';
import { GoodreadsData, ReadingStatus } from '../types.js';
import { normalizeTitle } from '../utils/hash.js';

interface GoodreadsItem {
  title?: string;
  author_name?: string;
  user_rating?: string;
  user_read_at?: string;
  user_review?: string;
  link?: string;
}

export class GoodreadsEnricher {
  private userId?: string;
  private parser: Parser;

  constructor(userId?: string) {
    this.userId = userId;
    this.parser = new Parser();
  }

  async fetchUserShelves(): Promise<Map<string, GoodreadsData>> {
    const bookMap = new Map<string, GoodreadsData>();
    if (!this.userId) {
      return bookMap;
    }

    const shelves: Array<{ shelf: string; status: ReadingStatus }> = [
      { shelf: 'currently-reading', status: 'Currently Reading' },
      { shelf: 'read', status: 'Read' },
      { shelf: 'to-read', status: 'Want to Read' }
    ];

    for (const { shelf, status } of shelves) {
      try {
        const feedUrl = `https://www.goodreads.com/review/list_rss/${this.userId}?shelf=${shelf}`;
        const feed = await this.parser.parseURL(feedUrl);

        for (const item of feed.items as GoodreadsItem[]) {
          if (!item.title) continue;
          const normalized = normalizeTitle(item.title);

          const rating = item.user_rating ? parseInt(item.user_rating, 10) : undefined;
          bookMap.set(normalized, {
            status,
            userRating: isNaN(rating || NaN) ? undefined : rating,
            dateRead: item.user_read_at || undefined,
            userReview: item.user_review || undefined
          });
        }
      } catch (err) {
        console.warn(`Could not load Goodreads shelf "${shelf}": ${(err as Error).message}`);
      }
    }

    return bookMap;
  }
}
