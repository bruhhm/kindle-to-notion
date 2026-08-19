import * as dotenv from 'dotenv';
import { createNotionClient } from '../notion/client.js';
import { scaffoldNotionDatabases } from '../notion/schema.js';

dotenv.config();

async function runSetup() {
  const apiKey = process.env.NOTION_API_KEY;
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID;

  if (!apiKey) {
    console.error('Error: NOTION_API_KEY is missing in .env');
    process.exit(1);
  }

  if (!parentPageId) {
    console.error('Error: NOTION_PARENT_PAGE_ID is missing in .env. Specify the ID of the Notion page where databases should be created.');
    process.exit(1);
  }

  const notion = createNotionClient(apiKey);
  const result = await scaffoldNotionDatabases(notion, parentPageId);

  console.log('\n================ NOTION SETUP COMPLETE ================');
  console.log('Save these IDs in your .env and GitHub Repository Secrets:\n');
  console.log(`NOTION_BOOKS_DATABASE_ID=${result.booksDatabaseId}`);
  console.log(`NOTION_HIGHLIGHTS_DATABASE_ID=${result.highlightsDatabaseId}`);
  console.log('========================================================\n');
}

runSetup().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
