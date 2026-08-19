import { chromium } from 'playwright';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

async function runLogin() {
  const domain = process.env.AMAZON_DOMAIN || 'amazon.com';
  const targetUrl = `https://read.${domain}/notebook`;
  const sessionPath = path.resolve(process.cwd(), '.kindle_session.json');

  console.log('====================================================');
  console.log(`Launching interactive browser for Amazon (${domain})...`);
  console.log('A browser window will appear on your screen.');
  console.log('1. Log into your Amazon account in the opened window.');
  console.log('2. Complete any 2FA/OTP if prompted.');
  console.log('3. Once you see your Kindle Highlights/Notebook on screen,');
  console.log('   the script will automatically capture your full session.');
  console.log('====================================================\n');

  const browser = await chromium.launch({
    headless: false
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();
  await page.goto(targetUrl);

  console.log('Waiting for login to complete on read.amazon.com/notebook...');

  try {
    await Promise.race([
      page.waitForURL((url) => url.hostname.includes('read.amazon') && url.pathname.includes('/notebook'), { timeout: 300000 }),
      page.waitForSelector('#kp-notebook-library, .kp-notebook-library-each-book', { timeout: 300000 })
    ]);
    console.log('Detected active Kindle Notebook session on read.amazon.com/notebook!');
  } catch {
    console.log('Timeout reached. Capturing current session state...');
  }

  await page.waitForTimeout(3000);

  // Save complete storage state (all cookies, domains, and tokens)
  await context.storageState({ path: sessionPath });
  const storageJson = fs.readFileSync(sessionPath, 'utf8');
  const base64State = Buffer.from(storageJson, 'utf8').toString('base64');

  await browser.close();

  // Automatically update .env file
  const envPath = path.resolve(process.cwd(), '.env');
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

  if (envContent.includes('AMAZON_COOKIE=')) {
    envContent = envContent.replace(/AMAZON_COOKIE=.*/g, `AMAZON_COOKIE="${base64State}"`);
  } else {
    envContent += `\nAMAZON_COOKIE="${base64State}"\n`;
  }

  fs.writeFileSync(envPath, envContent, 'utf8');

  console.log('\n================ SUCCESS ================');
  console.log('Full Kindle Session state saved to .kindle_session.json and .env!');
  console.log('=========================================\n');
}

runLogin().catch(err => {
  console.error('Login error:', err);
  process.exit(1);
});
