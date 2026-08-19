import * as dotenv from 'dotenv';
import { KindleScraper } from './scrapers/kindle.js';
import { BooksApiEnricher } from './enrichers/booksApi.js';
import { GoodreadsEnricher, FullGoodreadsBook } from './enrichers/goodreads.js';
import { GoodreadsWriter } from './goodreads/writer.js';
import { createNotionClient } from './notion/client.js';
import { NotionSyncEngine } from './notion/sync.js';
import { MergedBookData, KindleBook, ReadingStatus } from './types.js';
import { normalizeTitle } from './utils/hash.js';

dotenv.config();

async function main() {
  console.log('Starting Kindle & Goodreads to Notion Two-Way Sync Automation...');
  const startTime = Date.now();

  const notionApiKey = process.env.NOTION_API_KEY;
  const booksDbId = process.env.NOTION_BOOKS_DATABASE_ID;
  const highlightsDbId = process.env.NOTION_HIGHLIGHTS_DATABASE_ID;
  const amazonDomain = process.env.AMAZON_DOMAIN || 'amazon.com';
  const amazonCookie = process.env.AMAZON_COOKIE || '';
  const goodreadsUserId = process.env.GOODREADS_USER_ID || '166837688';
  const goodreadsCookie = process.env.GOODREADS_COOKIE || '';

  if (!notionApiKey || !booksDbId || !highlightsDbId) {
    throw new Error('Missing Notion configuration. Ensure NOTION_API_KEY, NOTION_BOOKS_DATABASE_ID, and NOTION_HIGHLIGHTS_DATABASE_ID are set.');
  }

  const notionClient = createNotionClient(notionApiKey);
  const syncEngine = new NotionSyncEngine({
    notion: notionClient,
    booksDatabaseId: booksDbId,
    highlightsDatabaseId: highlightsDbId
  });

  // 1. Fetch Goodreads Library as Primary Source
  console.log('Step 1: Fetching full library from Goodreads (Primary Source)...');
  const goodreadsEnricher = new GoodreadsEnricher(goodreadsUserId);
  const goodreadsBooks = await goodreadsEnricher.fetchAllBooks();
  console.log(`Loaded ${goodreadsBooks.length} books from Goodreads.`);

  // 2. Check for manual updates made in Notion to sync back to Goodreads (Two-Way)
  if (goodreadsCookie) {
    console.log('Checking for Notion status/rating updates to sync back to Goodreads...');
    const { byTitle } = await syncEngine.getExistingBooks();
    const grWriter = new GoodreadsWriter({ cookieString: goodreadsCookie });

    for (const gb of goodreadsBooks) {
      const normTitle = normalizeTitle(gb.title);
      const notionBook = byTitle.get(normTitle);

      if (notionBook && notionBook.currentStatus) {
        // If status changed in Notion compared to Goodreads
        if (notionBook.currentStatus !== gb.status) {
          console.log(`Detected Notion status change for "${gb.title}": ${gb.status} -> ${notionBook.currentStatus}`);
          await grWriter.updateBookShelfAndRating(gb.bookId || gb.title, notionBook.currentStatus as ReadingStatus, notionBook.currentRating);
          gb.status = notionBook.currentStatus as ReadingStatus;
        }
      }
    }
  }

  // 3. Scrape Kindle Library & Highlights
  console.log('Step 3: Extracting Kindle Library & Highlights...');
  let kindleBooks: KindleBook[] = [];
  try {
    const scraper = new KindleScraper({
      domain: amazonDomain,
      cookieString: amazonCookie
    });
    kindleBooks = await scraper.scrapeLibraryAndHighlights();
    console.log(`Extracted ${kindleBooks.length} books with highlights from Kindle.`);
  } catch (err) {
    console.warn(`Kindle scraper warning: ${(err as Error).message}. Proceeding with Goodreads library.`);
  }

  // Map Kindle books by normalized title and ASIN
  const kindleByTitle = new Map<string, KindleBook>();
  for (const kb of kindleBooks) {
    kindleByTitle.set(normalizeTitle(kb.title), kb);
  }

  // 4. Merge Goodreads + Kindle + Google Books Enrichment
  console.log('Step 4: Merging data sources and enriching missing metadata...');
  const booksApiEnricher = new BooksApiEnricher();
  const mergedBooks: MergedBookData[] = [];
  const processedTitles = new Set<string>();

  // Process Goodreads books first
  for (const gb of goodreadsBooks) {
    const normTitle = normalizeTitle(gb.title);
    processedTitles.add(normTitle);

    const matchingKindle = kindleByTitle.get(normTitle);
    const highlights = matchingKindle?.highlights || [];

    let coverUrl = gb.coverUrl;
    let summary = gb.summary;
    let genres: string[] = [];
    let pageCount: number | undefined = undefined;
    let publisher: string | undefined = undefined;
    let publishedDate: string | undefined = undefined;
    let isbn = gb.isbn;

    // If missing cover or summary, enrich from Google Books / Open Library
    if (!coverUrl || !summary) {
      const enriched = await booksApiEnricher.enrichMetadata(gb.title, gb.author, matchingKindle?.asin);
      coverUrl = coverUrl || enriched.highResCoverUrl;
      summary = summary || enriched.summary;
      genres = enriched.genres;
      pageCount = enriched.pageCount;
      publisher = enriched.publisher;
      publishedDate = enriched.publishedDate;
      isbn = isbn || enriched.isbn;
    }

    mergedBooks.push({
      asin: matchingKindle?.asin || gb.bookId,
      title: gb.title,
      author: gb.author,
      status: gb.status,
      coverUrl,
      summary,
      genres,
      pageCount,
      publisher,
      publishedDate,
      isbn,
      rating: gb.userRating,
      totalHighlights: highlights.length,
      lastSynced: new Date().toISOString(),
      highlights
    });
  }

  // Process any Kindle books not on Goodreads
  for (const kb of kindleBooks) {
    const normTitle = normalizeTitle(kb.title);
    if (!processedTitles.has(normTitle)) {
      processedTitles.add(normTitle);

      const enriched = await booksApiEnricher.enrichMetadata(kb.title, kb.author, kb.asin);
      let status: ReadingStatus = 'Want to Read';
      if (kb.lastReadPercentage && kb.lastReadPercentage >= 95) {
        status = 'Read';
      } else if (kb.highlights.length > 0) {
        status = 'Currently Reading';
      }

      mergedBooks.push({
        asin: kb.asin,
        title: kb.title,
        author: kb.author,
        status,
        coverUrl: enriched.highResCoverUrl || kb.coverUrl,
        summary: enriched.summary,
        genres: enriched.genres,
        pageCount: enriched.pageCount,
        publisher: enriched.publisher,
        publishedDate: enriched.publishedDate,
        isbn: enriched.isbn,
        totalHighlights: kb.highlights.length,
        lastSynced: new Date().toISOString(),
        highlights: kb.highlights
      });
    }
  }

  console.log(`Prepared ${mergedBooks.length} total books for Notion synchronization.`);

  // 5. Sync to Notion
  console.log('Step 5: Synchronizing full library with Notion...');
  const stats = await syncEngine.syncAll(mergedBooks);

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n================ SYNC COMPLETE ================');
  console.log(`Execution Duration: ${durationSec}s`);
  console.log(`Total Books in Notion: ${mergedBooks.length}`);
  console.log(`Books Created: ${stats.booksCreated}`);
  console.log(`Books Updated: ${stats.booksUpdated}`);
  console.log(`Highlights Created: ${stats.highlightsCreated}`);
  console.log(`Highlights Skipped (Deduplicated): ${stats.highlightsSkipped}`);
  if (stats.errors.length > 0) {
    console.log(`Errors encountered: ${stats.errors.length}`);
  }
  console.log('================================================\n');
}

main().catch(err => {
  console.error('Fatal sync error:', err);
  process.exit(1);
});
