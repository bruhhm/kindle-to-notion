import axios from 'axios';
import { EnrichedMetadata } from '../types.js';

interface GoogleBooksItem {
  volumeInfo?: {
    title?: string;
    description?: string;
    categories?: string[];
    pageCount?: number;
    publisher?: string;
    publishedDate?: string;
    imageLinks?: {
      extraLarge?: string;
      large?: string;
      medium?: string;
      small?: string;
      thumbnail?: string;
    };
    industryIdentifiers?: Array<{ type: string; identifier: string }>;
  };
}

export class BooksApiEnricher {
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async enrichMetadata(title: string, author: string, asin?: string): Promise<EnrichedMetadata> {
    const enriched: EnrichedMetadata = {
      genres: []
    };

    // Clean title for search
    const cleanTitle = title
      .replace(/\(.*?\)/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/–.*$/g, '')
      .replace(/-.*$/g, '')
      .replace(/:\s*.*$/g, '')
      .trim();

    const cleanAuthor = author
      .replace(/\sand\s.*$/i, '')
      .replace(/,.*$/i, '')
      .trim();

    // 1. Try Google Books API
    try {
      await this.sleep(400); // Respect rate limits
      const query = `intitle:${encodeURIComponent(cleanTitle)}+inauthor:${encodeURIComponent(cleanAuthor)}`;
      const googleBooksUrl = `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1`;

      const response = await axios.get<{ items?: GoogleBooksItem[] }>(googleBooksUrl, { timeout: 8000 });

      if (response.data.items && response.data.items.length > 0) {
        const volume = response.data.items[0].volumeInfo;
        if (volume) {
          enriched.summary = volume.description;
          enriched.genres = volume.categories || [];
          enriched.pageCount = volume.pageCount;
          enriched.publisher = volume.publisher;
          enriched.publishedDate = volume.publishedDate;

          const images = volume.imageLinks;
          if (images) {
            const rawCover = images.extraLarge || images.large || images.medium || images.thumbnail;
            if (rawCover) {
              enriched.highResCoverUrl = rawCover.replace('http://', 'https://').replace('&edge=curl', '');
            }
          }

          if (volume.industryIdentifiers) {
            const isbnObj = volume.industryIdentifiers.find(id => id.type === 'ISBN_13' || id.type === 'ISBN_10');
            if (isbnObj) {
              enriched.isbn = isbnObj.identifier;
            }
          }
        }
      }
    } catch (err) {
      // Continue to Open Library fallback
    }

    // 2. Open Library Fallback
    if (!enriched.highResCoverUrl || !enriched.summary) {
      try {
        await this.sleep(300);
        const olUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(cleanTitle)}&author=${encodeURIComponent(cleanAuthor)}&limit=1`;
        const olRes = await axios.get<{ docs?: Array<{ key?: string; cover_i?: number; first_publish_year?: number; subject?: string[] }> }>(olUrl, { timeout: 8000 });

        if (olRes.data.docs && olRes.data.docs.length > 0) {
          const doc = olRes.data.docs[0];
          if (!enriched.highResCoverUrl && doc.cover_i) {
            enriched.highResCoverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
          }
          if (enriched.genres.length === 0 && doc.subject) {
            enriched.genres = doc.subject.slice(0, 4);
          }
        }
      } catch (err) {
        // Fallback catch
      }
    }

    return enriched;
  }
}
