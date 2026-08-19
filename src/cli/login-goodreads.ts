import { chromium, BrowserContext } from 'playwright';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

async function runGoodreadsLogin() {
  const targetUrl = 'https://www.goodreads.com/user/sign_in';

  console.log('====================================================');
  console.log('Launching interactive browser for Goodreads login...');
  console.log('Please log into your Goodreads account in the opened window.');
  console.log('Once signed in, your session cookies will be saved to .env.');
  console.log('====================================================\n');

  const browser = await chromium.launch({
    headless: false
  });

  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();
  await page.goto(targetUrl);

  console.log('Waiting for active session and login completion...');

  try {
    // Wait for user profile indicator or home feed after sign-in
    await page.waitForSelector('.userIcon, a[href*="/user/show"], .siteHeader__personalNav', { timeout: 180000 });
    console.log('Detected active Goodreads session!');
  } catch {
    console.log('Timeout reached. Extracting available cookies...');
  }

  const cookies = await context.cookies();
  const grCookies = cookies.filter(c => c.domain.includes('goodreads'));
  const cookieString = grCookies.map(c => `${c.name}=${c.value}`).join('; ');

  await browser.close();

  if (cookieString.length === 0) {
    console.error('Failed to capture Goodreads cookies. Please retry.');
    process.exit(1);
  }

  // Automatically update .env file
  const envPath = path.resolve(process.cwd(), '.env');
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

  if (envContent.includes('GOODREADS_COOKIE=')) {
    envContent = envContent.replace(/GOODREADS_COOKIE=.*/g, `GOODREADS_COOKIE="${cookieString}"`);
  } else {
    envContent += `\nGOODREADS_COOKIE="${cookieString}"\n`;
  }

  fs.writeFileSync(envPath, envContent, 'utf8');

  console.log('\n================ SUCCESS ================');
  console.log('Goodreads Session Cookies automatically saved to .env!');
  console.log('=========================================\n');
}

runGoodreadsLogin().catch(err => {
  console.error('Goodreads login error:', err);
  process.exit(1);
});
