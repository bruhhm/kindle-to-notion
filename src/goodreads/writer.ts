import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { ReadingStatus } from '../types.js';

export interface GoodreadsWriterConfig {
  cookieString: string;
}

export class GoodreadsWriter {
  private cookieString: string;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  constructor(config: GoodreadsWriterConfig) {
    this.cookieString = config.cookieString;
  }

  private parseCookies(cookieStr: string): Array<{ name: string; value: string; domain: string; path: string; secure: boolean }> {
    const cleanStr = cookieStr.replace(/[\r\n]+/g, ' ').trim();
    const pairs = cleanStr.split(';').map(p => p.trim()).filter(p => p.length > 0);

    const cookies: Array<{ name: string; value: string; domain: string; path: string; secure: boolean }> = [];

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
        domain: '.goodreads.com',
        path: '/',
        secure: true
      });
    }

    return cookies;
  }

  async init(): Promise<boolean> {
    if (!this.cookieString || this.cookieString.trim().length === 0) {
      return false;
    }
    try {
      this.browser = await chromium.launch({ headless: true });
      this.context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
      const parsedCookies = this.parseCookies(this.cookieString);
      await this.context.addCookies(parsedCookies);
      return true;
    } catch (err) {
      console.warn(`Could not initialize Goodreads writer: ${(err as Error).message}`);
      return false;
    }
  }

  async updateBookShelfAndRating(bookIdOrTitle: string, status: ReadingStatus, rating?: number): Promise<boolean> {
    if (!this.context) {
      return false;
    }

    const page: Page = await this.context.newPage();

    try {
      let targetUrl = '';
      if (/^\d+/.test(bookIdOrTitle)) {
        targetUrl = `https://www.goodreads.com/book/show/${bookIdOrTitle}`;
      } else {
        targetUrl = `https://www.goodreads.com/search?q=${encodeURIComponent(bookIdOrTitle)}`;
      }

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

      if (targetUrl.includes('/search')) {
        const firstBook = await page.$('.bookTitle, a.bookTitle');
        if (firstBook) {
          await firstBook.click();
          await page.waitForLoadState('domcontentloaded');
        }
      }

      await page.waitForTimeout(1000);

      let targetShelfText = 'Want to read';
      if (status === 'Currently Reading') {
        targetShelfText = 'Currently reading';
      } else if (status === 'Read') {
        targetShelfText = 'Read';
      }

      const shelfDropdownBtn = await page.$('button[aria-label*="choose a shelf"], .ShelfStatus button, .wtrShelfOptions, button.Button--wantsToRead');
      if (shelfDropdownBtn) {
        await shelfDropdownBtn.click();
        await page.waitForTimeout(500);

        const shelfOption = await page.$(`button:has-text("${targetShelfText}"), li:has-text("${targetShelfText}")`);
        if (shelfOption) {
          await shelfOption.click();
          console.log(`Updated Goodreads shelf for "${bookIdOrTitle}" to "${targetShelfText}".`);
        }
      }

      if (rating && rating >= 1 && rating <= 5) {
        const starBtn = await page.$(`button[aria-label*="Rate ${rating} star"], button[aria-label*="${rating} of 5"]`);
        if (starBtn) {
          await starBtn.click();
          console.log(`Updated Goodreads rating for "${bookIdOrTitle}" to ${rating} stars.`);
        }
      }

      await page.waitForTimeout(500);
      return true;
    } catch (err) {
      console.warn(`Could not update Goodreads book "${bookIdOrTitle}": ${(err as Error).message}`);
      return false;
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
    }
  }
}
