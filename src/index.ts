import * as dotenv from 'dotenv';
import { KindleScraper } from './scrapers/kindle.js';
import { BooksApiEnricher } from './enrichers/booksApi.js';
import { GoodreadsEnricher } from './enrichers/goodreads.js';
import { createNotionClient } from './notion/client.js';
import { NotionSyncEngine } from './notion/sync.js';
import { MergedBookData, ReadingStatus } from './types.js';
import { normalizeTitle } from './utils/hash.js';

dotenv.config();

async function main() {
  console.log('Starting Kindle to Notion Sync Automation...');
  const startTime = Date.now();

  const notionApiKey = process.env.NOTION_API_KEY;
  const booksDbId = process.env.NOTION_BOOKS_DATABASE_ID;
  const highlightsDbId = process.env.NOTION_HIGHLIGHTS_DATABASE_ID;
  const amazonDomain = process.env.AMAZON_DOMAIN || 'amazon.com';
  const amazonCookie = process.env.AMAZON_COOKIE || '';
  const goodreadsUserId = process.env.GOODREADS_USER_ID;

  if (!notionApiKey || !booksDbId || !highlightsDbId) {
    throw new Error('Missing Notion configuration. Ensure NOTION_API_KEY, NOTION_BOOKS_DATABASE_ID, and NOTION_HIGHLIGHTS_DATABASE_ID are set.');
  }

  console.log('Step 1: Extracting Kindle Library & Highlights...');
  const scraper = new KindleScraper({
    domain: amazonDomain,
    cookieString: amazonCookie
  });
  const kindleBooks = await scraper.scrapeLibraryAndHighlights();
  console.log(`Successfully extracted ${kindleBooks.length} books from Kindle.`);

  console.log('Step 2: Fetching Goodreads data (shelves and ratings)...');
  const goodreadsEnricher = new GoodreadsEnricher(goodreadsUserId);
  const goodreadsMap = await goodreadsEnricher.fetchUserShelves();
  console.log(`Loaded ${goodreadsMap.size} books from Goodreads shelves.`);

  console.log('Step 3: Enriching metadata (covers, summaries, genres, page counts)...');
  const booksApiEnricher = new BooksApiEnricher();
  const mergedBooks: MergedBookData[] = [];

  for (const kb of kindleBooks) {
    const enrichedMeta = await booksApiEnricher.enrichMetadata(kb.title, kb.author, kb.asin);
    const grData = goodreadsMap.get(normalizeTitle(kb.title));

    let status: ReadingStatus = 'Want to Read';
    if (grData?.status) {
      status = grData.status;
    } else if (kb.lastReadPercentage && kb.lastReadPercentage >= 95) {
      status = 'Read';
    } else if (kb.highlights.length > 0 || (kb.lastReadPercentage && kb.lastReadPercentage > 0)) {
      status = 'Currently Reading';
    }

    mergedBooks.push({
      asin: kb.asin,
      title: kb.title,
      author: kb.author,
      status,
      coverUrl: enrichedMeta.highResCoverUrl || kb.coverUrl,
      summary: enrichedMeta.summary,
      genres: enrichedMeta.genres,
      pageCount: enrichedMeta.pageCount,
      publisher: enrichedMeta.publisher,
      publishedDate: enrichedMeta.publishedDate,
      isbn: enrichedMeta.isbn,
      rating: grData?.userRating,
      totalHighlights: kb.highlights.length,
      lastSynced: new Date().toISOString(),
      highlights: kb.highlights
    });
  }

  console.log('Step 4: Synchronizing with Notion databases and checking deduplication...');
  const notionClient = createNotionClient(notionApiKey);
  const syncEngine = new NotionSyncEngine({
    notion: notionClient,
    booksDatabaseId: booksDbId,
    highlightsDatabaseId: highlightsDbId
  });

  const stats = await syncEngine.syncAll(mergedBooks);

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n================ SYNC COMPLETE ================');
  console.log(`Execution Duration: ${durationSec}s`);
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
