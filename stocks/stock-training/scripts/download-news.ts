#!/usr/bin/env npx tsx
/**
 * download-news.ts — Download historical news from Alpaca News API.
 *
 * Scans trading-agent/data/{date}/ folders for tickers (from bars-1m.json.gz),
 * downloads news for each date, and saves as news.json.gz in the same folder.
 *
 * Usage:
 *   tsx scripts/download-news.ts                          # all dates missing news
 *   tsx scripts/download-news.ts 2025-01-01 2025-12-31    # specific range
 *   tsx scripts/download-news.ts --force                  # re-download all
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Config ─────────────────────────────────────────────────────────────────

const ALPACA_KEY_ID = process.env.ALPACA_KEY_ID || 'AKAS3FTVF54TKVHQSOO44I5XJH';
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY || 'Br5quiybxDxEhw2WsX1EhHMq83f4TZX4RAhoxzkdQG2d';
const ALPACA_NEWS_URL = 'https://data.alpaca.markets/v1beta1/news';

const DATA_DIR = path.resolve(__dirname, '../../trading-agent/data');
const RATE_LIMIT_MS = 0; // Alpaca supports 10K req/sec

interface AlpacaNewsArticle {
  id: number;
  headline: string;
  author: string;
  created_at: string;
  updated_at: string;
  summary: string;
  url: string;
  symbols: string[];
  source: string;
}

interface AlpacaNewsResponse {
  news: AlpacaNewsArticle[];
  next_page_token?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


function saveNewsGz(dateDir: string, articles: AlpacaNewsArticle[]): void {
  const outPath = path.join(dateDir, 'news.json.gz');
  // Save only the fields we need (headline, timestamp, symbols, source, summary)
  const slim = articles.map((a) => ({
    id: a.id,
    headline: a.headline,
    created_at: a.created_at,
    symbols: a.symbols,
    source: a.source,
    summary: a.summary || '',
  }));
  const json = JSON.stringify(slim);
  const compressed = zlib.gzipSync(json);
  fs.writeFileSync(outPath, compressed);
}

// ── Alpaca News Fetcher ────────────────────────────────────────────────────

async function fetchAllNewsForDate(
  dateStr: string,
): Promise<AlpacaNewsArticle[]> {
  // Fetch ALL news for the date (no symbol filter) — much faster, 1-3 requests per day
  const start = `${dateStr}T04:00:00-05:00`;
  const end = `${dateStr}T20:00:00-05:00`;

  const allArticles: AlpacaNewsArticle[] = [];
  const seenIds = new Set<number>();
  let pageToken: string | undefined;
  let pages = 0;
  const maxPages = 50; // ~2500 articles max per day

  do {
    try {
      const params: Record<string, string> = {
        start,
        end,
        limit: '50',
        sort: 'asc',
      };
      if (pageToken) {
        params.page_token = pageToken;
      }

      const res = await axios.get<AlpacaNewsResponse>(ALPACA_NEWS_URL, {
        params,
        headers: {
          'APCA-API-KEY-ID': ALPACA_KEY_ID,
          'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
        },
        timeout: 15000,
      });

      const articles = res.data.news || [];
      for (const article of articles) {
        if (!seenIds.has(article.id)) {
          seenIds.add(article.id);
          allArticles.push(article);
        }
      }

      pageToken = res.data.next_page_token;
      pages++;

      if (pageToken) await sleep(RATE_LIMIT_MS);
    } catch (err: any) {
      if (err?.response?.status === 429) {
        console.log(`    Rate limited, waiting 5s...`);
        await sleep(5000);
        continue;
      }
      console.error(`    Error fetching news: ${err.message}`);
      break;
    }
  } while (pageToken && pages < maxPages);

  return allArticles;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const nonFlagArgs = args.filter((a) => !a.startsWith('--'));

  const startDate = nonFlagArgs[0] || '';
  const endDate = nonFlagArgs[1] || '';

  if (!fs.existsSync(DATA_DIR)) {
    console.error(`Data directory not found: ${DATA_DIR}`);
    process.exit(1);
  }

  // Get all date directories
  let dateDirs = fs.readdirSync(DATA_DIR)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  // Filter by date range if specified
  if (startDate) {
    dateDirs = dateDirs.filter((d) => d >= startDate);
  }
  if (endDate) {
    dateDirs = dateDirs.filter((d) => d <= endDate);
  }

  console.log(`Found ${dateDirs.length} date directories`);
  if (startDate || endDate) {
    console.log(`  Range: ${startDate || 'start'} → ${endDate || 'end'}`);
  }

  // Filter dates that need downloading
  const toDownload: string[] = [];
  let skipped = 0;

  for (const dateStr of dateDirs) {
    const dateDir = path.join(DATA_DIR, dateStr);
    const newsFile = path.join(dateDir, 'news.json.gz');
    if (fs.existsSync(newsFile) && !force) {
      skipped++;
    } else {
      toDownload.push(dateStr);
    }
  }

  console.log(`  To download: ${toDownload.length}, already done: ${skipped}`);

  // Process in parallel batches of 10
  const CONCURRENCY = 10;
  let downloaded = 0;
  let totalArticles = 0;

  for (let i = 0; i < toDownload.length; i += CONCURRENCY) {
    const batch = toDownload.slice(i, i + CONCURRENCY);

    const results = await Promise.all(
      batch.map(async (dateStr) => {
        const dateDir = path.join(DATA_DIR, dateStr);
        const articles = await fetchAllNewsForDate(dateStr);
        saveNewsGz(dateDir, articles);
        return { dateStr, count: articles.length };
      }),
    );

    for (const { dateStr, count } of results) {
      totalArticles += count;
      downloaded++;
      console.log(`  ${dateStr}: ${count} articles saved`);
    }

    console.log(`  Progress: ${downloaded}/${toDownload.length}`);
  }

  console.log(`\nDone!`);
  console.log(`  Downloaded: ${downloaded} days`);
  console.log(`  Skipped: ${skipped} days (already had news)`);
  console.log(`  Total articles: ${totalArticles}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
