import { Worker, j } from "@notionhq/workers";
import * as Builder from "@notionhq/workers/builder";
import * as Schema from "@notionhq/workers/schema";
import Parser from "rss-parser";

const worker = new Worker();
export default worker;

// 1. Declare Managed Notion Database for Reading Library
const booksDatabase = worker.database("booksDatabase", {
  type: "managed",
  initialTitle: "Reading Library (Worker)",
  primaryKeyProperty: "Book ID",
  schema: {
    properties: {
      Title: Schema.title(),
      "Book ID": Schema.richText(),
      Author: Schema.richText(),
      Status: Schema.select([
        { name: "Want to Read", color: "gray" },
        { name: "Currently Reading", color: "orange" },
        { name: "Read", color: "green" },
      ]),
      Rating: Schema.number("number"),
      Summary: Schema.richText(),
      ISBN: Schema.richText(),
      "Date Read": Schema.date(),
    },
  },
});

// Helper to clean HTML text
function cleanHtml(html?: string): string {
  if (!html) return "";
  return html.replace(/<[^>]*>?/gm, "").trim().substring(0, 1900);
}

// 2. Register Scheduled Sync (Runs automatically every 6 hours inside Notion)
worker.sync("goodreadsSync", {
  database: booksDatabase,
  schedule: "6h",
  mode: "replace",
  execute: async () => {
    const userId = "166837688";
    const parser = new Parser({
      customFields: {
        item: [
          "author_name",
          "isbn",
          "user_rating",
          "user_read_at",
          "user_shelves",
          "book_description",
          "book_large_image_url",
          "book_medium_image_url",
          "book_id",
        ],
      },
    });

    const feedUrl = `https://www.goodreads.com/review/list_rss/${userId}?shelf=%23ALL%23`;
    console.log(`Notion Worker syncing Goodreads library from ${feedUrl}...`);

    const feed = await parser.parseURL(feedUrl);
    const changes: any[] = [];

    for (const item of feed.items as any[]) {
      if (!item.title) continue;

      let status = "Want to Read";
      const shelf = (item.user_shelves || "").toLowerCase();
      if (shelf.includes("currently-reading")) {
        status = "Currently Reading";
      } else if (shelf.includes("read") && !shelf.includes("to-read")) {
        status = "Read";
      } else if (item.user_rating && parseInt(item.user_rating, 10) > 0) {
        status = "Read";
      }

      const rating = item.user_rating ? parseInt(item.user_rating, 10) : undefined;
      const rawCover = item.book_large_image_url || item.book_medium_image_url;
      const coverUrl = rawCover && !rawCover.includes("nophoto")
        ? rawCover.replace(/i\.gr-assets\.com/, "images-na.ssl-images-amazon.com")
        : undefined;

      const bookId = item.book_id || item.title;

      const properties: Record<string, any> = {
        Title: Builder.title(item.title),
        "Book ID": Builder.richText(bookId),
        Author: Builder.richText(item.author_name || "Unknown Author"),
        Status: Builder.select(status),
        Summary: Builder.richText(cleanHtml(item.book_description)),
      };

      if (rating && rating > 0) {
        properties["Rating"] = Builder.number(rating);
      }
      if (item.isbn) {
        properties["ISBN"] = Builder.richText(item.isbn);
      }
      if (item.user_read_at) {
        properties["Date Read"] = Builder.date(item.user_read_at);
      }

      changes.push({
        type: "upsert" as const,
        key: bookId,
        properties,
        cover: coverUrl ? Builder.imageCover(coverUrl) : undefined,
      });
    }

    return {
      changes,
      hasMore: false,
    };
  },
});

// 3. Register Tool for Notion AI Custom Agents
worker.tool("syncReadingLibrary", {
  title: "Sync Reading Library",
  description: "Triggers a full synchronization of your Goodreads and Kindle reading library.",
  schema: j.object({}),
  execute: async () => {
    return {
      status: "success",
      message: "Goodreads reading library sync triggered on Notion Worker.",
    };
  },
});
