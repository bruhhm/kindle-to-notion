# Kindle to Notion Sync Automation

Automated sync engine that connects your Kindle library, highlights, notes, and bookmarks to a relational Notion workspace every 6 hours via GitHub Actions.

## Key Features

- **Kindle Library & Highlights Sync**: Extracts all books, reading progress, highlights, personal notes, bookmarks, and locations.
- **Relational Notion Workspace**: Two linked databases ("Kindle Books" and "Kindle Highlights") with dual-property relations.
- **Metadata Enrichment**: Fetches high-resolution cover images, synopses/summaries, genres, and page counts via Google Books and Open Library APIs.
- **Goodreads Integration**: Maps reading shelves (`Want to Read`, `Currently Reading`, `Read`), user star ratings, and read dates.
- **Robust Deduplication**: SHA-256 deterministic hashing (`asin + location + text`) ensures zero duplicate highlights across runs.
- **Automated 6-Hour Scheduler**: Runs seamlessly on GitHub Actions with encrypted repository secrets.

---

## Setup Guide

### 1. Prerequisites & Installation

Install project dependencies:

```bash
npm install
npx playwright install chromium
```

### 2. Configure Notion Integration

1. Go to [Notion Integrations](https://www.notion.so/my-integrations) and create a new integration named `Kindle Sync`.
2. Copy your **Internal Integration Secret** (`NOTION_API_KEY`).
3. In Notion, open or create the parent page where you want your reading databases to live.
4. Click the three dots `...` in the top-right of that Notion page, go to **Connections**, and connect your integration.
5. Copy the parent page ID from the URL:
   `https://www.notion.so/My-Workspace/Reading-Dashboard-<PARENT_PAGE_ID>`

### 3. Scaffold Databases Automatically

Create a `.env` file from the template:

```bash
cp .env.example .env
```

Add your `NOTION_API_KEY` and `NOTION_PARENT_PAGE_ID` to `.env`, then run:

```bash
npm run setup-notion
```

This command automatically creates the two relational databases with all properties and prints `NOTION_BOOKS_DATABASE_ID` and `NOTION_HIGHLIGHTS_DATABASE_ID`. Add these IDs to your `.env`.

### 4. Authenticate with Amazon

Run the login helper:

```bash
npm run login
```

A browser window will open. Log into your Amazon account. The script will automatically capture your session cookies and print `AMAZON_COOKIE`. Paste this value into your `.env`.

### 5. (Optional) Configure Goodreads

If you want Goodreads reading shelves and star ratings synced, find your Goodreads User ID from your profile URL (`https://www.goodreads.com/user/show/<USER_ID>`) and set:

```bash
GOODREADS_USER_ID=<YOUR_USER_ID>
```

### 6. Run Manual Sync

Test the sync engine locally:

```bash
npm run sync
```

---

## GitHub Actions 6-Hour Cloud Deployment

To automate the sync every 6 hours for free without keeping your computer on:

1. Push this repository to GitHub.
2. In your GitHub repository, go to **Settings** > **Secrets and variables** > **Actions**.
3. Create the following Repository Secrets:
   - `NOTION_API_KEY`
   - `NOTION_BOOKS_DATABASE_ID`
   - `NOTION_HIGHLIGHTS_DATABASE_ID`
   - `AMAZON_COOKIE`
   - `AMAZON_DOMAIN` (e.g., `amazon.com`)
   - `GOODREADS_USER_ID` (optional)
4. The workflow in `.github/workflows/sync.yml` will automatically run every 6 hours (`0 */6 * * *`) and can also be triggered manually under the **Actions** tab.
