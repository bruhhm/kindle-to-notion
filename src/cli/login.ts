import { chromium } from 'playwright';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

async function runLogin() {
  const domain = process.env.AMAZON_DOMAIN || 'amazon.com';
  const targetUrl = `https://read.${domain}/notebook`;

  console.log('====================================================');
  console.log(`Launching interactive browser for Amazon (${domain})...`);
  console.log('A browser window will appear on your screen.');
  console.log('Please sign into your Amazon account in the opened window.');
  console.log('Once signed in, the cookies will be automatically saved to .env.');
  console.log('====================================================\n');

  const browser = await chromium.launch({
    headless: false
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();
  await page.goto(targetUrl);

  console.log('Waiting for active session and login completion...');

  try {
    await page.waitForSelector('#kp-notebook-library, .kp-notebook-library-each-book', { timeout: 180000 });
    console.log('Detected active Kindle Notebook session!');
  } catch {
    console.log('Timeout reached. Extracting available cookies...');
  }

  const cookies = await context.cookies();
  const amazonCookies = cookies.filter(c => c.domain.includes('amazon'));
  const cookieString = amazonCookies.map(c => `${c.name}=${c.value}`).join('; ');

  await browser.close();

  if (cookieString.length === 0) {
    console.error('Failed to capture Amazon cookies. Please retry.');
    process.exit(1);
  }

  // Automatically update .env file
  const envPath = path.resolve(process.cwd(), '.env');
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

  if (envContent.includes('AMAZON_COOKIE=')) {
    envContent = envContent.replace(/AMAZON_COOKIE=.*/g, `AMAZON_COOKIE="${cookieString}"`);
  } else {
    envContent += `\nAMAZON_COOKIE="${cookieString}"\n`;
  }

  fs.writeFileSync(envPath, envContent, 'utf8');

  console.log('\n================ SUCCESS ================');
  console.log('Amazon Session Cookies automatically saved to .env!');
  console.log('=========================================\n');
}

runLogin().catch(err => {
  console.error('Login error:', err);
  process.exit(1);
});
