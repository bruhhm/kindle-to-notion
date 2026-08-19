import { chromium, BrowserContext, Page } from 'playwright';
import { KindleBook, KindleHighlight, HighlightType } from '../types.js';
import { generateHighlightHash } from '../utils/hash.js';

export interface KindleScraperConfig {
  domain: string;
  cookieString: string;
}

export class KindleScraper {
  private domain: string;
  private cookieString: string;

  constructor(config: KindleScraperConfig) {
    this.domain = config.domain || 'amazon.com';
    this.cookieString = config.cookieString;
  }

  private parseCookies(cookieStr: string): Array<{ name: string; value: string; domain: string; path: string; secure: boolean; sameSite: 'Lax' | 'None' | 'Strict' }> {
    const cleanStr = cookieStr.replace(/[\r\n]+/g, ' ').trim();
    const pairs = cleanStr.split(';').map(p => p.trim()).filter(p => p.length > 0);

    const cookies: Array<{ name: string; value: string; domain: string; path: string; secure: boolean; sameSite: 'Lax' | 'None' | 'Strict' }> = [];

    for (const pair of pairs) {
      const equalIdx = pair.indexOf('=');
      if (equalIdx === -1) continue;

      const name = pair.substring(0, equalIdx).trim();
      let value = pair.substring(equalIdx + 1).trim();

      if (!name) continue;

      // Unquote value if wrapped
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      cookies.push({
        name,
        value,
        domain: `.${this.domain}`,
        path: '/',
        secure: true,
        sameSite: 'Lax'
      });
    }

    return cookies;
  }

  async scrapeLibraryAndHighlights(): Promise<KindleBook[]> {
    if (!this.cookieString || this.cookieString.trim().length === 0) {
      throw new Error('AMAZON_COOKIE is required. Run "npm run login" to capture your session cookies.');
    }

    const browser = await chromium.launch({ headless: true });
    const context: BrowserContext = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const parsedCookies = this.parseCookies(this.cookieString);
    await context.addCookies(parsedCookies);

    const page: Page = await context.newPage();
    const books: KindleBook[] = [];

    try {
      const notebookUrl = `https://read.${this.domain}/notebook`;
      console.log(`Navigating to ${notebookUrl}...`);

      const response = await page.goto(notebookUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (!response || response.status() >= 400) {
        throw new Error(`Failed to load Kindle notebook: HTTP ${response?.status()}`);
      }

      await page.waitForTimeout(3000);

      // Check if redirected to sign-in page
      const currentUrl = page.url();
      if (currentUrl.includes('/ap/signin') || currentUrl.includes('/signin')) {
        throw new Error('Amazon session cookies expired or invalid. Please re-run "npm run login".');
      }

      // Wait for books list container
      await page.waitForSelector('#kp-notebook-library, .kp-notebook-library-each-book', { timeout: 30000 });

      // Extract all book elements from sidebar
      const bookElements = await page.$$('.kp-notebook-library-each-book');
      console.log(`Found ${bookElements.length} books in Kindle Notebook.`);

      for (let i = 0; i < bookElements.length; i++) {
        const bookEl = bookElements[i];

        // Click on the book to load highlights
        await bookEl.click();
        await page.waitForTimeout(2000);

        const asin = await bookEl.getAttribute('id') || `book_${i}`;
        const titleEl = await bookEl.$('h2.kp-notebook-searchable');
        const title = titleEl ? (await titleEl.innerText()).trim() : 'Unknown Title';

        const authorEl = await bookEl.$('p.kp-notebook-searchable');
        const author = authorEl ? (await authorEl.innerText()).replace(/^By:\s*/i, '').trim() : 'Unknown Author';

        const coverEl = await bookEl.$('img.kp-notebook-cover-image');
        const coverUrl = coverEl ? await coverEl.getAttribute('src') : undefined;

        // Scrape highlights for currently active book
        const highlights: KindleHighlight[] = [];
        const highlightElements = await page.$$('#kp-notebook-annotations > .a-row.kp-notebook-highlight');

        for (const hlEl of highlightElements) {
          const textEl = await hlEl.$('#highlight');
          const text = textEl ? (await textEl.innerText()).trim() : '';

          if (!text) continue;

          const noteEl = await hlEl.$('#note');
          const note = noteEl ? (await noteEl.innerText()).trim() : undefined;

          const locationEl = await hlEl.$('#kp-annotation-location');
          const location = locationEl ? (await locationEl.getAttribute('value')) || '' : '';

          const type: HighlightType = note && !text ? 'Note' : 'Highlight';
          const hashId = generateHighlightHash(asin, location, text);

          highlights.push({
            id: hashId,
            text,
            note,
            location: location || undefined,
            type,
            dateAdded: new Date().toISOString()
          });
        }

        books.push({
          asin,
          title,
          author,
          coverUrl: coverUrl || undefined,
          lastReadPercentage: highlights.length > 0 ? 50 : 0,
          highlights
        });

        console.log(`Extracted "${title}" by ${author} (${highlights.length} highlights).`);
      }
    } finally {
      await browser.close();
    }

    return books;
  }
}
