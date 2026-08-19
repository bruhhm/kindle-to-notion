# Kindle and Goodreads to Notion Sync Engine

An automated, high-performance synchronization system that bridges your Amazon Kindle highlights and Goodreads reading library directly into a relational Notion database workspace.

---

## Table of Contents

- [Overview](#overview)
- [Architecture and Data Flow](#architecture-and-data-flow)
- [Core Features](#core-features)
- [Database Schema](#database-schema)
  - [Kindle Books Database](#1-kindle-books-database)
  - [Kindle Highlights Database](#2-kindle-highlights-database)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Getting Started and Local Setup](#getting-started-and-local-setup)
  - [1. Installation](#1-installation)
  - [2. Notion Integration Setup](#2-notion-integration-setup)
  - [3. Database Provisioning](#3-database-provisioning)
  - [4. Session Authentication](#4-session-authentication)
  - [5. Execute Local Sync](#5-execute-local-sync)
- [Deployment Modes](#deployment-modes)
  - [Mode 1: GitHub Actions (Recommended)](#mode-1-github-actions-cloud-scheduler)
  - [Mode 2: Official Notion Worker](#mode-2-official-notion-worker-beta)
  - [Mode 3: Cloudflare Worker Webhook Relay](#mode-3-cloudflare-worker-webhook-relay)
- [1-Click Notion Button Trigger](#1-click-notion-button-trigger)
- [Deduplication and Integrity](#deduplication-and-integrity)
- [Performance and Optimizations](#performance-and-optimizations)
- [Troubleshooting](#troubleshooting)

---

## Overview

Reading progress and annotations are often fragmented across multiple platforms:
- **Amazon Kindle**: Stores private book highlights, personal notes, bookmarks, and location data in the Kindle Cloud Reader (`read.amazon.com/notebook`).
- **Goodreads**: Serves as the primary source of truth for your complete reading history across all shelves (*Read*, *Currently Reading*, *Want to Read*), star ratings, read dates, and reading goals.
- **Notion**: Provides a centralized workspace for knowledge management, search, book notes, and dashboard views.

This project unifies all three platforms into a bidirectional, deduplicated system that keeps your reading library and annotations synchronized automatically.

---

## Architecture and Data Flow

```text
+-------------------------+      +---------------------------+
|  Goodreads Library RSS  |      |   Amazon Kindle Notebook  |
|  (Primary Library Data) |      | (Highlights, Notes, ASIN) |
+------------+------------+      +-------------+-------------+
             |                                 |
             |   +-------------------------+   |
             +-->|  Metadata Enricher      |<--+
                 |  (Google Books API /    |
                 |   Open Library API)     |
                 +------------+------------+
                              |
                              v
                 +-------------------------+
                 |    Sync & Deduplication |
                 |          Engine         |
                 |  (SHA-256 / Normalized) |
                 +------------+------------+
                              |
                              v
                 +-------------------------+
                 |  Notion Relational DBs  |
                 |  - Kindle Books         |
                 |  - Kindle Highlights    |
                 +-------------------------+
```

1. **Primary Library Ingestion**: The engine parses your Goodreads `#ALL#` RSS feed to capture all books, current shelf statuses (*Read*, *Currently Reading*, *Want to Read*), user ratings (1-5 stars), read dates, and descriptions.
2. **Annotation Scraping**: Playwright launches a headless browser session to extract full Kindle notebook highlights, color codes, locations, personal notes, and ASINs from `read.amazon.com/notebook`.
3. **Metadata Enrichment**: If cover images or summaries are missing, the enricher queries the Google Books API and Open Library to fetch high-resolution cover art, page counts, genres, and publishers.
4. **Relational Syncing**: The engine upserts records into the `Kindle Books` and `Kindle Highlights` Notion databases, automatically linking every highlight to its parent book via Notion relations.

---

## Core Features

- **Goodreads as Primary Source**: Ingests your entire reading catalog with zero missing titles.
- **Full Kindle Annotation Extraction**: Scrapes highlights, user notes, bookmarks, and location identifiers.
- **Automated Relational Linking**: Every highlight is linked to its respective book in Notion.
- **Deterministic Deduplication**: Uses SHA-256 hashing for highlights (`generateHighlightHash`) and title normalization to prevent duplicate database rows.
- **High-Resolution Covers & Summaries**: Automatically enriches metadata from Google Books and Open Library.
- **Automated Cloud Scheduling**: Configured with GitHub Actions to run every 6 hours (`0 */6 * * *`).
- **On-Demand 1-Click Sync**: Supports Notion button triggers, repository dispatches, and Cloudflare Worker relays.
- **Notion Worker Support**: Includes native `@notionhq/workers` implementation for in-Notion serverless execution.

---

## Database Schema

The automated provisioner (`npm run setup-notion`) creates two relational Notion databases:

### 1. Kindle Books Database

| Property | Notion Type | Description |
| :--- | :--- | :--- |
| `Title` | Title | Book title |
| `Author` | Rich Text | Author name(s) |
| `Status` | Select | Reading status (`Read`, `Currently Reading`, `Want to Read`) |
| `Rating` | Number | User rating (1 to 5 stars) |
| `Total Highlights` | Number | Number of highlights synced for this book |
| `Summary` | Rich Text | Book description / synopsis |
| `ASIN` | Rich Text | Amazon Standard Identification Number |
| `ISBN` | Rich Text | International Standard Book Number |
| `Page Count` | Number | Total page count |
| `Genres` | Multi-Select | Book genres / categories |
| `Last Synced` | Date | Timestamp of the latest sync run |
| `Highlights` | Relation | Two-way relation linking to the `Kindle Highlights` database |

### 2. Kindle Highlights Database

| Property | Notion Type | Description |
| :--- | :--- | :--- |
| `Name` | Title | Snippet preview or bookmark label |
| `Highlight` | Rich Text | Complete text content of the highlight |
| `Book` | Relation | Two-way relation linking back to the `Kindle Books` database |
| `Type` | Select | Annotation type (`Highlight`, `Note`, `Bookmark`) |
| `Location` | Rich Text | Kindle location identifier (e.g., `Location 1245`) |
| `Color` | Select | Kindle highlight color (`Yellow`, `Blue`, `Pink`, `Orange`) |
| `Personal Note` | Rich Text | User-written note attached to the highlight |
| `Hash ID` | Rich Text | Deterministic SHA-256 hash for deduplication |
| `Created Date` | Date | Timestamp when the highlight was added |

---

## Project Structure

```text
kindle-to-notion/
├── .github/
│   └── workflows/
│       └── sync.yml                 # 6-Hour GitHub Actions Cloud Workflow
├── cloudflare-worker/
│   ├── src/
│   │   └── index.ts                 # 1-Click Cloudflare Edge Webhook Relay
│   ├── package.json
│   └── wrangler.toml                # Cloudflare Worker Configuration
├── notion-worker/
│   ├── src/
│   │   └── index.ts                 # Official Notion Worker (@notionhq/workers)
│   ├── package.json
│   ├── tsconfig.json
│   └── workers.json                 # Notion Worker Manifest
├── src/
│   ├── cli/
│   │   ├── login.ts                 # Interactive Amazon Playwright Cookie Capturer
│   │   ├── login-goodreads.ts       # Interactive Goodreads Cookie Capturer
│   │   └── setup.ts                 # Automated Notion Relational Schema Provisioner
│   ├── enrichers/
│   │   ├── booksApi.ts              # Google Books & Open Library Metadata Enricher
│   │   └── goodreads.ts             # Goodreads #ALL# RSS Feed Parser
│   ├── goodreads/
│   │   └── writer.ts                # Goodreads Two-Way Shelf & Rating Updater
│   ├── notion/
│   │   ├── client.ts                # Notion SDK Factory
│   │   ├── schema.ts                # Notion Database Schema Provisioner
│   │   └── sync.ts                  # Batch-Concurrent Notion Sync Engine
│   ├── scrapers/
│   │   └── kindle.ts                # Playwright Headless Kindle Notebook Scraper
│   ├── utils/
│   │   └── hash.ts                  # SHA-256 Deterministic Hash & Normalization
│   ├── index.ts                     # Main Sync Orchestration Entrypoint
│   └── types.ts                     # TypeScript Type Definitions
├── .env.example                     # Environment Variable Template
├── package.json                     # Node.js Package Configuration & Scripts
├── tsconfig.json                    # TypeScript Configuration
└── README.md                        # Project Documentation
```

---

## Prerequisites

- **Node.js**: Version 20.x or higher.
- **Notion Account**: With an active internal integration token.
- **Goodreads Account**: User ID (visible in your Goodreads profile URL, e.g., `https://www.goodreads.com/user/show/<USER_ID>-...`).
- **Amazon Account**: For Kindle highlights scraping.

---

## Environment Variables

Create a `.env` file in the root directory (based on `.env.example`):

```env
# Notion API Configuration
NOTION_API_KEY=ntn_your_notion_integration_token_here
NOTION_PARENT_PAGE_ID=your_parent_page_id_here
NOTION_BOOKS_DATABASE_ID=your_books_database_id_here
NOTION_HIGHLIGHTS_DATABASE_ID=your_highlights_database_id_here

# Amazon Kindle Configuration
AMAZON_DOMAIN=amazon.com
AMAZON_COOKIE="your_captured_amazon_cookies_here"

# Goodreads Configuration
GOODREADS_USER_ID=166837688
GOODREADS_COOKIE="your_captured_goodreads_cookies_here"
```

---

## Getting Started and Local Setup

### 1. Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/bruhhm/kindle-to-notion.git
cd kindle-to-notion
npm install
npx playwright install chromium
```

### 2. Notion Integration Setup

1. Visit [notion.so/my-integrations](https://www.notion.so/my-integrations) and create a new integration named `Kindle Sync`.
2. Copy the **Internal Integration Secret** (`ntn_...`) and set it as `NOTION_API_KEY` in your `.env`.
3. In Notion, open or create the parent page where you want the databases to live.
4. Click the `...` menu in the top right -> **Connect to** -> Select your `Kindle Sync` integration.
5. Copy the 32-character ID from your page URL and set it as `NOTION_PARENT_PAGE_ID` in `.env`.

### 3. Database Provisioning

Run the automated setup script:

```bash
npm run setup-notion
```

This will automatically create both `Kindle Books` and `Kindle Highlights` databases with full schema and relations, and save their IDs into your `.env` file.

### 4. Session Authentication

To allow the scraper to access your private Kindle highlights:

```bash
npm run login
```

A Chromium browser window will open. Log into your Amazon account. Once you reach `read.amazon.com/notebook`, the script automatically captures your session cookies and writes them to `.env`.

*(Optional)* To capture Goodreads cookies for two-way updates:

```bash
npm run login-goodreads
```

### 5. Execute Local Sync

Run the complete sync engine:

```bash
npm run sync
```

---

## Deployment Modes

### Mode 1: GitHub Actions Cloud Scheduler

The repository includes a GitHub Actions workflow (`.github/workflows/sync.yml`) that runs every 6 hours and supports manual triggers.

#### Setup:
1. Push this repository to GitHub (Private repository recommended).
2. Go to **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret**.
3. Add the following repository secrets:
   - `NOTION_API_KEY`
   - `NOTION_BOOKS_DATABASE_ID`
   - `NOTION_HIGHLIGHTS_DATABASE_ID`
   - `AMAZON_DOMAIN` (e.g. `amazon.com`)
   - `AMAZON_COOKIE`
   - `GOODREADS_USER_ID`
   - `GOODREADS_COOKIE` (Optional)

---

### Mode 2: Official Notion Worker (Beta)

Notion Workers (`@notionhq/workers`) allow scheduled background syncs and custom AI agent tools to execute directly on Notion's infrastructure.

The worker is located in the `notion-worker/` directory.

#### Deploying to Notion:
```bash
cd notion-worker
npm install
npx ntn workers deploy
```

Once deployed, the Notion Worker:
- Runs `goodreadsSync` on a 6-hour schedule directly on Notion's servers.
- Exposes the `syncReadingLibrary` capability to Notion AI / Custom Agents.

---

### Mode 3: Cloudflare Worker Webhook Relay

If you want a 1-click web URL to trigger your GitHub Actions workflow from any browser or Notion link without exposing tokens:

The Cloudflare Worker is located in `cloudflare-worker/`.

#### Deploying:
```bash
cd cloudflare-worker
npx wrangler login
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```

---

## 1-Click Notion Button Trigger

You can trigger your GitHub Actions cloud sync directly from Notion using two methods:

### Method A: Notion Database Automation
1. Add a button or automation in your Notion database.
2. Set action to **Send webhook**:
   - **URL**: `https://api.github.com/repos/bruhhm/kindle-to-notion/dispatches`
   - **Headers**:
     - `Authorization`: `Bearer <GITHUB_PERSONAL_ACCESS_TOKEN>`
     - `Accept`: `application/vnd.github+json`
     - `User-Agent`: `Notion-Automation`
3. Add a formula property named `event_type` with formula `"notion_sync"` and check it in the Content checklist.

### Method B: Notion Link / Bookmark Block
1. Add a text link or callout block in your Notion page:
   `[Sync Library Now](https://kindle-notion-sync.<your-subdomain>.workers.dev)`
2. Clicking the link opens a confirmation window and immediately triggers the cloud runner.

---

## Deduplication and Integrity

- **Highlight Deduplication**: Every highlight receives a deterministic SHA-256 hash based on normalized book title, highlight text, and location:
  $$\text{Hash} = \text{SHA-256}(\text{normalize}(\text{title}) + \text{text} + \text{location})$$
  Before inserting a highlight, the engine verifies the hash against existing database rows. Existing highlights are skipped without duplicate API calls.
- **Book Deduplication**: Books are indexed in memory by ASIN and normalized title (`normalizeTitle`). If a book already exists, its metadata, highlights count, and timestamp are updated while preserving user-edited notes.

---

## Performance and Optimizations

- **Concurrent Batch Pacing**: Notion database updates are processed in concurrent batches of 5 requests (`Promise.all`), achieving a full sync of 100+ books in **~40 seconds** while respecting Notion's 3 req/sec rate limits.
- **Single Context Browser Pooling**: The Playwright scraper and Goodreads writer share a unified browser context, avoiding cold-start process overhead.
- **Linux CI/CD Clean Encoding**: All files are stored with standard UTF-8 encoding (BOM stripped) for seamless execution across Linux GitHub Actions runners and Windows environments.

---

## Troubleshooting

### Amazon Cookies Expired
- **Symptom**: `Kindle scraper notice: Amazon session cookies expired or invalid`.
- **Fix**: Run `npm run login` locally to refresh your session cookie and update the `AMAZON_COOKIE` secret in GitHub Actions.

### Notion 404 / Object Not Found
- **Symptom**: `Could not find database with ID...`
- **Fix**: Ensure your Notion integration is shared with the parent page. In Notion: Parent page -> `...` menu -> **Connect to** -> select your integration.

### GitHub Actions 422 Unprocessable Entity
- **Symptom**: `Invalid request: missing ref` or `keys are not permitted`.
- **Fix**: Use the `repository_dispatch` endpoint (`/repos/{owner}/{repo}/dispatches`) with `{"event_type": "notion_sync"}` when calling from webhooks.
