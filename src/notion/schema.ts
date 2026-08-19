import { Client } from '@notionhq/client';

export interface DatabaseCreationResult {
  booksDatabaseId: string;
  highlightsDatabaseId: string;
}

export async function scaffoldNotionDatabases(notion: Client, parentPageId: string): Promise<DatabaseCreationResult> {
  console.log(`Scaffolding Notion relational databases under parent page ${parentPageId}...`);

  // 1. Create Highlights Database
  const highlightsDb = await notion.databases.create({
    parent: { type: 'page_id', page_id: parentPageId },
    title: [
      {
        type: 'text',
        text: { content: 'Kindle Highlights' }
      }
    ],
    properties: {
      'Name': {
        title: {}
      },
      'Highlight Text': {
        rich_text: {}
      },
      'Note': {
        rich_text: {}
      },
      'Location': {
        rich_text: {}
      },
      'Type': {
        select: {
          options: [
            { name: 'Highlight', color: 'blue' },
            { name: 'Note', color: 'yellow' },
            { name: 'Bookmark', color: 'green' }
          ]
        }
      },
      'Hash ID': {
        rich_text: {}
      },
      'Date Added': {
        date: {}
      }
    }
  });

  const highlightsDatabaseId = highlightsDb.id;
  console.log(`Created "Kindle Highlights" Database (ID: ${highlightsDatabaseId})`);

  // 2. Create Books Database with Relation to Highlights
  const booksDb = await notion.databases.create({
    parent: { type: 'page_id', page_id: parentPageId },
    title: [
      {
        type: 'text',
        text: { content: 'Kindle Books' }
      }
    ],
    properties: {
      'Title': {
        title: {}
      },
      'Author': {
        rich_text: {}
      },
      'Status': {
        select: {
          options: [
            { name: 'Want to Read', color: 'gray' },
            { name: 'Currently Reading', color: 'orange' },
            { name: 'Read', color: 'green' }
          ]
        }
      },
      'Summary': {
        rich_text: {}
      },
      'ASIN': {
        rich_text: {}
      },
      'ISBN': {
        rich_text: {}
      },
      'Genres': {
        multi_select: {
          options: []
        }
      },
      'Page Count': {
        number: {
          format: 'number'
        }
      },
      'Rating': {
        number: {
          format: 'number'
        }
      },
      'Total Highlights': {
        number: {
          format: 'number'
        }
      },
      'Last Synced': {
        date: {}
      },
      'Highlights': {
        relation: {
          database_id: highlightsDatabaseId,
          type: 'dual_property',
          dual_property: {
            synced_property_name: 'Book'
          } as any
        }
      }
    }
  });

  const booksDatabaseId = booksDb.id;
  console.log(`Created "Kindle Books" Database (ID: ${booksDatabaseId})`);

  return {
    booksDatabaseId,
    highlightsDatabaseId
  };
}
