#!/usr/bin/env npx tsx
/**
 * add-news-features.ts — Enrich training CSV with news/catalyst features.
 *
 * Reads the existing training CSV, loads news.json.gz from trading-agent/data/{date}/,
 * and adds news-based features per candle row. Outputs a new CSV with news columns.
 *
 * News features per candle:
 *   - has_news_premarket:     1 if ticker had news between 4:00-9:30 AM ET that day
 *   - has_news_1h:            1 if ticker had news in the last 60 min before this candle
 *   - news_count_today:       total news articles for this ticker today (up to this candle)
 *   - news_count_premarket:   news articles in premarket (4:00-9:30 AM ET)
 *   - hours_since_news:       hours since most recent news for this ticker (capped at 24, 24=no news)
 *   - catalyst_strength:      0=NONE, 1=WEAK, 2=MODERATE, 3=STRONG (best from today's headlines)
 *   - catalyst_is_dilutive:   1 if any headline is dilutive (offering/dilution)
 *   - catalyst_is_earnings:   1 if any headline mentions earnings
 *   - catalyst_is_fda:        1 if any headline mentions FDA
 *   - catalyst_is_buyout:     1 if any headline mentions buyout/acquisition/merger
 *
 * Usage:
 *   tsx scripts/add-news-features.ts data/training-v2-morning-full.csv
 *   tsx scripts/add-news-features.ts data/training-v2-morning-full.csv --output data/training-v2-with-news.csv
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { classifyHeadline, type ClassifiedCatalyst } from '../src/catalyst/catalyst-classifier.js';

const NEWS_DATA_DIR = path.resolve(__dirname, '../../trading-agent/data');

// ── Types ──────────────────────────────────────────────────────────────────

interface NewsArticle {
  id: number;
  headline: string;
  created_at: string;  // ISO timestamp
  symbols: string[];
  source: string;
  summary: string;
}

interface NewsFeatures {
  has_news_premarket: number;
  has_news_1h: number;
  news_count_today: number;
  news_count_premarket: number;
  hours_since_news: number;
  catalyst_strength: number;       // 0=NONE, 1=WEAK, 2=MODERATE, 3=STRONG
  catalyst_is_dilutive: number;
  catalyst_is_earnings: number;
  catalyst_is_fda: number;
  catalyst_is_buyout: number;
}

const NEWS_COLUMNS = [
  'has_news_premarket',
  'has_news_1h',
  'news_count_today',
  'news_count_premarket',
  'hours_since_news',
  'catalyst_strength',
  'catalyst_is_dilutive',
  'catalyst_is_earnings',
  'catalyst_is_fda',
  'catalyst_is_buyout',
];

const EMPTY_NEWS: NewsFeatures = {
  has_news_premarket: 0,
  has_news_1h: 0,
  news_count_today: 0,
  news_count_premarket: 0,
  hours_since_news: 24,
  catalyst_strength: 0,
  catalyst_is_dilutive: 0,
  catalyst_is_earnings: 0,
  catalyst_is_fda: 0,
  catalyst_is_buyout: 0,
};

// ── News Loading ───────────────────────────────────────────────────────────

// Cache: date -> { symbol -> NewsArticle[] }
const newsCache = new Map<string, Map<string, NewsArticle[]>>();

function loadNewsForDate(dateStr: string): Map<string, NewsArticle[]> {
  const cached = newsCache.get(dateStr);
  if (cached) return cached;

  const newsFile = path.join(NEWS_DATA_DIR, dateStr, 'news.json.gz');
  const bySymbol = new Map<string, NewsArticle[]>();

  if (!fs.existsSync(newsFile)) {
    newsCache.set(dateStr, bySymbol);
    return bySymbol;
  }

  try {
    const compressed = fs.readFileSync(newsFile);
    const raw = zlib.gunzipSync(compressed).toString('utf-8');
    const articles: NewsArticle[] = JSON.parse(raw);

    for (const article of articles) {
      for (const sym of article.symbols) {
        const list = bySymbol.get(sym) || [];
        list.push(article);
        bySymbol.set(sym, list);
      }
    }
  } catch (err) {
    // Corrupted file — skip
  }

  newsCache.set(dateStr, bySymbol);
  return bySymbol;
}

// ── Feature Computation ────────────────────────────────────────────────────

const STRENGTH_MAP: Record<string, number> = {
  NONE: 0,
  WEAK: 1,
  MODERATE: 2,
  STRONG: 3,
};

function parseEtMinutes(timeStr: string): number {
  // "09:30" or "14:15" -> minutes since midnight
  const parts = timeStr.split(':');
  if (parts.length < 2) return 0;
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function articleEtMinutes(article: NewsArticle): number {
  // Convert ISO timestamp to ET minutes since midnight
  const d = new Date(article.created_at);
  const etStr = d.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return parseEtMinutes(etStr);
}

function computeNewsFeatures(
  symbol: string,
  dateStr: string,
  candleTimeEt: string, // "09:30", "10:15", etc.
): NewsFeatures {
  const newsBySymbol = loadNewsForDate(dateStr);
  const articles = newsBySymbol.get(symbol);

  if (!articles || articles.length === 0) {
    return { ...EMPTY_NEWS };
  }

  const candleMinutes = parseEtMinutes(candleTimeEt);
  const premarketEnd = 9 * 60 + 30; // 9:30 AM ET

  // Filter articles up to this candle time (no future leakage)
  const articlesBeforeCandle = articles.filter((a) => {
    const artMin = articleEtMinutes(a);
    return artMin <= candleMinutes;
  });

  if (articlesBeforeCandle.length === 0) {
    return { ...EMPTY_NEWS };
  }

  // Premarket articles (4:00 - 9:30 AM)
  const premarketArticles = articlesBeforeCandle.filter((a) => {
    const m = articleEtMinutes(a);
    return m >= 4 * 60 && m < premarketEnd;
  });

  // Articles in last 60 minutes
  const recentArticles = articlesBeforeCandle.filter((a) => {
    const m = articleEtMinutes(a);
    return (candleMinutes - m) >= 0 && (candleMinutes - m) <= 60;
  });

  // Hours since most recent article
  const latestArticleMin = Math.max(...articlesBeforeCandle.map(articleEtMinutes));
  const minutesSinceNews = candleMinutes - latestArticleMin;
  const hoursSinceNews = Math.min(minutesSinceNews / 60, 24);

  // Classify all headlines — take the strongest catalyst
  let bestStrength = 0;
  let isDilutive = 0;
  let isEarnings = 0;
  let isFda = 0;
  let isBuyout = 0;

  for (const article of articlesBeforeCandle) {
    const classified = classifyHeadline(article.headline);
    const s = STRENGTH_MAP[classified.strength] || 0;
    if (s > bestStrength) bestStrength = s;
    if (classified.is_dilutive) isDilutive = 1;
    if (classified.category === 'EARNINGS_BEAT') isEarnings = 1;
    if (classified.category === 'FDA_APPROVAL') isFda = 1;
    if (classified.category === 'BUYOUT_ACQUISITION_MERGER') isBuyout = 1;
  }

  return {
    has_news_premarket: premarketArticles.length > 0 ? 1 : 0,
    has_news_1h: recentArticles.length > 0 ? 1 : 0,
    news_count_today: articlesBeforeCandle.length,
    news_count_premarket: premarketArticles.length,
    hours_since_news: Math.round(hoursSinceNews * 100) / 100,
    catalyst_strength: bestStrength,
    catalyst_is_dilutive: isDilutive,
    catalyst_is_earnings: isEarnings,
    catalyst_is_fda: isFda,
    catalyst_is_buyout: isBuyout,
  };
}

// ── Main: Stream CSV and enrich ────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));

  if (args.length === 0) {
    console.error('Usage: tsx scripts/add-news-features.ts <input.csv> [--output <output.csv>]');
    process.exit(1);
  }

  let inputPath = args[0];
  if (!path.isAbsolute(inputPath)) {
    inputPath = path.resolve(__dirname, '..', inputPath);
  }

  let outputPath: string | undefined;
  const outputIdx = flags.indexOf('--output');
  if (outputIdx !== -1) {
    outputPath = process.argv[process.argv.indexOf('--output') + 1];
  }

  if (!outputPath) {
    // Default: input-with-news.csv
    const ext = path.extname(inputPath);
    const base = path.basename(inputPath, ext);
    outputPath = path.join(path.dirname(inputPath), `${base}-with-news${ext}`);
  }

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  console.log(`Input:  ${inputPath}`);
  console.log(`Output: ${outputPath}`);

  const rl = readline.createInterface({
    input: fs.createReadStream(inputPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  const outStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' });

  let lineNum = 0;
  let headerCols: string[] = [];
  let symbolIdx = -1;
  let dateIdx = -1;
  let timeIdx = -1;
  let enriched = 0;
  let noNews = 0;
  let lastDate = '';

  for await (const line of rl) {
    lineNum++;

    if (lineNum === 1) {
      // Header row — add news columns
      headerCols = line.split(',');
      symbolIdx = headerCols.indexOf('symbol');
      dateIdx = headerCols.indexOf('date');
      timeIdx = headerCols.indexOf('candle_time_et');

      if (symbolIdx === -1 || dateIdx === -1 || timeIdx === -1) {
        console.error('CSV must have symbol, date, candle_time_et columns');
        process.exit(1);
      }

      outStream.write(line + ',' + NEWS_COLUMNS.join(',') + '\n');
      continue;
    }

    const cols = line.split(',');
    if (cols.length < headerCols.length) {
      // Empty or malformed line
      outStream.write(line + ',' + NEWS_COLUMNS.map(() => '0').join(',') + '\n');
      continue;
    }

    const symbol = cols[symbolIdx];
    const dateStr = cols[dateIdx];
    const timeEt = cols[timeIdx];

    // Progress logging
    if (dateStr !== lastDate) {
      if (lastDate) {
        console.log(`  ${lastDate}: ${enriched} enriched, ${noNews} no-news`);
      }
      lastDate = dateStr;
      enriched = 0;
      noNews = 0;
    }

    const features = computeNewsFeatures(symbol, dateStr, timeEt);

    if (features.news_count_today > 0) {
      enriched++;
    } else {
      noNews++;
    }

    const newsValues = NEWS_COLUMNS.map((col) => {
      const val = features[col as keyof NewsFeatures];
      return val != null ? val : 0;
    });

    outStream.write(line + ',' + newsValues.join(',') + '\n');

    if (lineNum % 500000 === 0) {
      console.log(`  Processed ${lineNum.toLocaleString()} rows...`);
    }
  }

  // Final date log
  if (lastDate) {
    console.log(`  ${lastDate}: ${enriched} enriched, ${noNews} no-news`);
  }

  outStream.end();
  console.log(`\nDone! ${lineNum - 1} rows processed → ${outputPath}`);

  // Free memory
  newsCache.clear();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
