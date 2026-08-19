import { chromium, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
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
    const sessionFilePath = path.resolve(process.cwd(), '.kindle_session.json');
    let storageStateData: any = undefined;

    // 1. Try reading from .kindle_session.json
    if (fs.existsSync(sessionFilePath)) {
      try {
        storageStateData = JSON.parse(fs.readFileSync(sessionFilePath, 'utf8'));
      } catch {}
    }

    // 2. Try parsing base64 storage state from cookie string
    if (!storageStateData && this.cookieString) {
      try {
        const decoded = Buffer.from(this.cookieString, 'base64').toString('utf8');
        const parsed = JSON.parse(decoded);
        if (parsed.cookies || parsed.origins) {
          storageStateData = parsed;
        }
      } catch {}
    }

    const browser = await chromium.launch({ headless: true });
    let context: BrowserContext;

    if (storageStateData) {
      context = await browser.newContext({
        storageState: storageStateData,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
    } else {
      if (!this.cookieString || this.cookieString.trim().length === 0) {
        await browser.close();
        throw new Error('AMAZON_COOKIE is required. Run "npm run login" to capture your session cookies.');
      }
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
      const parsedCookies = this.parseCookies(this.cookieString);
      await context.addCookies(parsedCookies);
    }

    const page: Page = await context.newPage();
    const books: KindleBook[] = [];

    try {
      const notebookUrl = `https://read.${this.domain}/notebook`;
      console.log(`Navigating to ${notebookUrl}...`);

      const response = await page.goto(notebookUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (!response || response.status() >= 400) {
        throw new Error(`Failed to load Kindle notebook: HTTP ${response?.status()}`);
      }

      await page.waitForTimeout(2000);

      // Check if redirected to sign-in page
      const currentUrl = page.url();
      if (currentUrl.includes('/ap/signin') || currentUrl.includes('/signin')) {
        throw new Error('Amazon session cookies expired or invalid. Please re-run "npm run login".');
      }

      // Wait for books list container
      await page.waitForSelector('#kp-notebook-library, .kp-notebook-library-each-book', { timeout: 20000 });

      // Extract all book elements from sidebar
      const bookElements = await page.$$('.kp-notebook-library-each-book');
      console.log(`Found ${bookElements.length} books in Kindle Notebook.`);

      for (let i = 0; i < bookElements.length; i++) {
        const bookEl = bookElements[i];

        try {
          await bookEl.click();
          await page.waitForTimeout(1000);

          const asin = (await bookEl.getAttribute('id')) || `book_${i}`;
          const titleEl = await bookEl.$('h2.kp-notebook-searchable');
          const titleText = titleEl ? await titleEl.innerText() : '';
          const title = titleText ? titleText.trim() : 'Untitled';

          const authorEl = await bookEl.$('p.kp-notebook-searchable');
          const authorText = authorEl ? await authorEl.innerText() : '';
          const author = authorText ? authorText.replace(/^By:\s*/i, '').trim() : 'Unknown Author';

          const coverImgEl = await bookEl.$('img.kp-notebook-cover-image');
          const coverUrl = coverImgEl ? (await coverImgEl.getAttribute('src')) || undefined : undefined;

          // Extract highlights from main pane
          const highlights: KindleHighlight[] = [];
          const highlightNodes = await page.$$('#kp-notebook-annotations .a-row.kp-notebook-highlight, #kp-notebook-annotations .kp-notebook-annotation, #kp-notebook-annotations .a-row');

          for (let j = 0; j < highlightNodes.length; j++) {
            const node = highlightNodes[j];

            const textEl = await node.$('#highlight, span.kp-notebook-highlight-text, .kp-notebook-highlight');
            const rawText = textEl ? await textEl.innerText() : '';
            const text = rawText ? rawText.trim() : '';

            if (!text) continue;

            const locEl = await node.$('#annotationLocation, #kp-annotation-location, span[id*="annotationLocation"]');
            const rawLoc = locEl ? await locEl.innerText() : '';
            const location = rawLoc ? rawLoc.trim() : undefined;

            const colorEl = await node.$('.kp-notebook-highlight-color, [class*="kp-notebook-highlight-color"]');
            const colorClass = colorEl ? await colorEl.getAttribute('class') : '';
            let color: 'Yellow' | 'Blue' | 'Pink' | 'Orange' | undefined = undefined;
            if (colorClass?.includes('yellow')) color = 'Yellow';
            else if (colorClass?.includes('blue')) color = 'Blue';
            else if (colorClass?.includes('pink')) color = 'Pink';
            else if (colorClass?.includes('orange')) color = 'Orange';

            const noteEl = await node.$('#note, span.kp-notebook-note, .kp-notebook-note');
            const rawNote = noteEl ? await noteEl.innerText() : '';
            const note = rawNote ? rawNote.trim() : undefined;

            const highlightId = generateHighlightHash(asin || title, location, text);

            highlights.push({
              id: highlightId,
              text,
              type: 'Highlight',
              location,
              color,
              note
            });
          }

          console.log(`Extracted "${title}" with ${highlights.length} highlights.`);

          books.push({
            asin,
            title,
            author,
            coverUrl,
            highlights
          });
        } catch (bookErr) {
          console.warn(`Error reading book element ${i}: ${(bookErr as Error).message}`);
        }
      }

      return books;
    } finally {
      await browser.close();
    }
  }
}
