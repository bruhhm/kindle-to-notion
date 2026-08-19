import { Client } from '@notionhq/client';

export function createNotionClient(apiKey: string): Client {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('NOTION_API_KEY is required in environment variables.');
  }

  return new Client({
    auth: apiKey
  });
}
