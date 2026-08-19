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

  private isNonEnglish(text?: string): boolean {
    if (!text) return false;
    return /[\u0600-\u06FF\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\u0590-\u05FF]/.test(text);
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

    // 1. Open Library (Primary English metadata without rate limits)
    try {
      await this.sleep(200);
      const olUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(cleanTitle)}&author=${encodeURIComponent(cleanAuthor)}&limit=1`;
      const olRes = await axios.get<{ docs?: Array<{ key?: string; cover_i?: number; first_publish_year?: number; subject?: string[] }> }>(olUrl, { timeout: 8000 });

      if (olRes.data.docs && olRes.data.docs.length > 0) {
        const doc = olRes.data.docs[0];
        if (doc.cover_i) {
          enriched.highResCoverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
        }
        if (doc.subject) {
          enriched.genres = doc.subject.slice(0, 4);
        }

        if (doc.key) {
          try {
            const workRes = await axios.get(`https://openlibrary.org${doc.key}.json`, { timeout: 6000 });
            let desc = workRes.data.description;
            if (typeof desc === 'object' && desc?.value) desc = desc.value;
            if (typeof desc === 'string' && desc.trim().length > 20 && !this.isNonEnglish(desc)) {
              enriched.summary = desc.trim();
            }
          } catch {}
        }
      }
    } catch {}

    // 2. Google Books API (English-restricted fallback)
    if (!enriched.summary) {
      try {
        await this.sleep(300);
        const query = `intitle:${encodeURIComponent(cleanTitle)}+inauthor:${encodeURIComponent(cleanAuthor)}`;
        const googleBooksUrl = `https://www.googleapis.com/books/v1/volumes?q=${query}&langRestrict=en&maxResults=3`;

        const response = await axios.get<{ items?: GoogleBooksItem[] }>(googleBooksUrl, { timeout: 8000 });

        if (response.data.items && response.data.items.length > 0) {
          for (const item of response.data.items) {
            const volume = item.volumeInfo;
            if (volume?.description && !this.isNonEnglish(volume.description)) {
              enriched.summary = volume.description;
              if (enriched.genres.length === 0 && volume.categories) {
                enriched.genres = volume.categories;
              }
              if (!enriched.pageCount) enriched.pageCount = volume.pageCount;
              if (!enriched.publisher) enriched.publisher = volume.publisher;
              if (!enriched.publishedDate) enriched.publishedDate = volume.publishedDate;
              break;
            }
          }
        }
      } catch {}
    }

    return enriched;
  }
}
