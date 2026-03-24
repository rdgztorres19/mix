#!/usr/bin/env npx ts-node

import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

type AlpacaAsset = {
  id: string;
  class: string;
  exchange: string;
  symbol: string;
  name: string;
  status: string;
  tradable: boolean;
  marginable: boolean;
  maintenance_margin_requirement: number | string;
  margin_requirement_long: number | string;
  margin_requirement_short: number | string;
  shortable: boolean;
  easy_to_borrow: boolean;
  fractionable: boolean;
};

type AlpacaBar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n?: number;
  vw?: number;
};

type BarsResponse = {
  bars: Record<string, AlpacaBar[]>;
  next_page_token?: string | null;
};

type SnapshotBar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n?: number;
  vw?: number;
};

type SnapshotItem = {
  dailyBar?: SnapshotBar;
  prevDailyBar?: SnapshotBar;
};

type SnapshotsResponse = Record<string, SnapshotItem>;

type DailyHistoryRow = {
  date: string;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trade_count: number;
  vwap: number;
  source: "historical_bar" | "snapshot";
};

type TopGainerRow = {
  date: string;
  rank: number;
  symbol: string;
  close: number;
  previous_close: number;
  pct_change: number;
  volume: number;
  source: "historical_bar" | "snapshot";
};

type TopGapperRow = {
  date: string;
  rank: number;
  symbol: string;
  open: number;
  previous_close: number;
  gap_pct: number;
  close: number;
  volume: number;
  source: "historical_bar" | "snapshot";
};

type TopHighOfDayRow = {
  date: string;
  rank: number;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  previous_close: number;
  high_day_pct: number;
  volume: number;
  source: "historical_bar" | "snapshot";
};

type CombinedDailyLeaderRow = {
  date: string;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  previous_close: number;
  gap_pct: number;
  high_day_pct: number;
  close_pct: number;
  volume: number;
  source: "historical_bar" | "snapshot";
};

type TopLeaderJsonRow = {
  symbol: string;
  Date: string;
  percent_gain: number;
  Volume: number;
  High: number;
};

type DailyTopBuckets = {
  gainers: TopGainerRow[];
  gappers: TopGapperRow[];
  highs: TopHighOfDayRow[];
};

const SCRIPT_DIR = process.cwd();
const DATA_DIR = path.join(SCRIPT_DIR, "data");

const ASSETS_CSV_PATH = path.join(DATA_DIR, "alpaca_assets.csv");
const DAILY_HISTORY_CSV_PATH = path.join(DATA_DIR, "alpaca_daily_history.csv");
const TOP_GAINERS_CSV_PATH = path.join(DATA_DIR, "alpaca_top_gainers.csv");
const TOP_GAPPERS_CSV_PATH = path.join(DATA_DIR, "alpaca_top_gappers.csv");
const TOP_HIGH_OF_DAY_CSV_PATH = path.join(DATA_DIR, "alpaca_top_high_of_day.csv");
const TOP_COMBINED_DAILY_LEADERS_CSV_PATH = path.join(
  DATA_DIR,
  "alpaca_top_combined_daily_leaders.csv",
);
const TOP_LEADERS_JSON_PATH = path.join(DATA_DIR, "top_leaders.json");

/**
 * Pega aquí tus credenciales.
 * - MARKET_DATA_*: bars / snapshots / realtime market data
 * - TRADING_*: assets endpoint
 */
const MARKET_DATA_KEY_ID =
  process.env.ALPACA_API_KEY_ID?.trim() ||
  "PASTE_MARKET_DATA_KEY_ID_HERE";

const MARKET_DATA_SECRET_KEY =
  process.env.ALPACA_API_SECRET_KEY?.trim() ||
  "PASTE_MARKET_DATA_SECRET_KEY_HERE";

const TRADING_KEY_ID =
  process.env.ALPACA_PAPER_API_KEY_ID?.trim() ||
  "PASTE_TRADING_KEY_ID_HERE";

const TRADING_SECRET_KEY =
  process.env.ALPACA_PAPER_API_SECRET_KEY?.trim() ||
  "PASTE_TRADING_SECRET_KEY_HERE";

const DATA_FROM_DATE = (process.env.DATA_FROM_DATE || "").trim();
const DATA_TO_DATE = (process.env.DATA_TO_DATE || "").trim() || todayYYYYMMDD();

const CHUNK_SIZE = toPositiveInt(process.env.CHUNK_SIZE, 200);
const CHUNK_CONCURRENCY = toPositiveInt(process.env.CHUNK_CONCURRENCY, 5);
const MAX_RETRIES = toPositiveInt(process.env.MAX_RETRIES, 20);
const TOP_N = toPositiveInt(process.env.TOP_N, 40);

const ONLY_ACTIVE = toBool(process.env.ONLY_ACTIVE, true);
const ONLY_TRADABLE = toBool(process.env.ONLY_TRADABLE, true);
const ONLY_US_EQUITY = toBool(process.env.ONLY_US_EQUITY, true);
const EXCLUDE_OTC_FROM_UNIVERSE = toBool(process.env.EXCLUDE_OTC_FROM_UNIVERSE, false);

/** true = borra outputs al empezar */
const REWRITE_OUTPUTS = toBool(process.env.REWRITE_OUTPUTS, true);

const ASSETS_URL = "https://paper-api.alpaca.markets/v2/assets";
const BARS_URL = "https://data.alpaca.markets/v2/stocks/bars";
const SNAPSHOTS_URL = "https://data.alpaca.markets/v2/stocks/snapshots";

function toPositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "y"].includes(value.trim().toLowerCase());
}

function todayYYYYMMDD(): string {
  return new Date().toISOString().slice(0, 10);
}

function validateConfig(): void {
  if (!DATA_FROM_DATE || !/^\d{4}-\d{2}-\d{2}$/.test(DATA_FROM_DATE)) {
    throw new Error("DATA_FROM_DATE must be YYYY-MM-DD");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(DATA_TO_DATE)) {
    throw new Error("DATA_TO_DATE must be YYYY-MM-DD");
  }
  if (DATA_FROM_DATE > DATA_TO_DATE) {
    throw new Error("DATA_FROM_DATE cannot be greater than DATA_TO_DATE");
  }

  if (!TRADING_KEY_ID || TRADING_KEY_ID.startsWith("PASTE_")) {
    throw new Error("Missing TRADING_KEY_ID / ALPACA_API_KEY_ID");
  }
  if (!TRADING_SECRET_KEY || TRADING_SECRET_KEY.startsWith("PASTE_")) {
    throw new Error("Missing TRADING_SECRET_KEY / ALPACA_API_SECRET_KEY");
  }
  if (!MARKET_DATA_KEY_ID || MARKET_DATA_KEY_ID.startsWith("PASTE_")) {
    throw new Error("Missing MARKET_DATA_KEY_ID");
  }
  if (!MARKET_DATA_SECRET_KEY || MARKET_DATA_SECRET_KEY.startsWith("PASTE_")) {
    throw new Error("Missing MARKET_DATA_SECRET_KEY");
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function resetOutputFiles(): void {
  if (!REWRITE_OUTPUTS) return;

  const files = [
    DAILY_HISTORY_CSV_PATH,
    TOP_GAINERS_CSV_PATH,
    TOP_GAPPERS_CSV_PATH,
    TOP_HIGH_OF_DAY_CSV_PATH,
    TOP_COMBINED_DAILY_LEADERS_CSV_PATH,
    TOP_LEADERS_JSON_PATH,
  ];

  for (const file of files) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no-body>";
  }
}

function tradingHeaders(): HeadersInit {
  return {
    accept: "application/json",
    "APCA-API-KEY-ID": TRADING_KEY_ID,
    "APCA-API-SECRET-KEY": TRADING_SECRET_KEY,
  };
}

function marketDataHeaders(): HeadersInit {
  return {
    accept: "application/json",
    "APCA-API-KEY-ID": MARKET_DATA_KEY_ID,
    "APCA-API-SECRET-KEY": MARKET_DATA_SECRET_KEY,
  };
}

async function fetchWithRetry(
  url: string,
  headers: HeadersInit,
  context: string,
): Promise<Response> {
  let attempt = 0;

  while (true) {
    attempt += 1;

    const res = await fetch(url, {
      method: "GET",
      headers,
    });

    if (res.status === 429) {
      if (attempt > MAX_RETRIES) {
        throw new Error(`[${context}] too many 429 retries`);
      }
      console.warn(`[429] ${context} -> waiting 60s before retry (${attempt}/${MAX_RETRIES})`);
      await sleep(60_000);
      continue;
    }

    if (res.status >= 500 && res.status <= 599) {
      if (attempt > MAX_RETRIES) {
        const body = await safeReadText(res);
        throw new Error(`[${context}] ${res.status}: ${body}`);
      }

      const backoff = Math.min(attempt * 5_000, 60_000);
      console.warn(`[${res.status}] ${context} -> waiting ${backoff}ms before retry`);
      await sleep(backoff);
      continue;
    }

    if (!res.ok) {
      const body = await safeReadText(res);
      throw new Error(`[${context}] ${res.status}: ${body}`);
    }

    return res;
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function minusCalendarDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function getDateOnly(ts: string): string {
  return ts.slice(0, 10);
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeCsv(
  filePath: string,
  headers: string[],
  rows: Array<Array<string | number | boolean>>,
): void {
  const lines = [
    headers.join(","),
    ...rows.map((r) => r.map(csvEscape).join(",")),
  ];
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
}

function appendTextLines(filePath: string, header: string, lines: string[]): void {
  const exists = fs.existsSync(filePath);
  if (!exists) {
    fs.writeFileSync(filePath, header + "\n", "utf8");
  }
  if (!lines.length) return;
  fs.appendFileSync(filePath, lines.join("\n") + "\n", "utf8");
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  out.push(current);
  return out;
}

function parseBooleanLoose(v: string): boolean {
  return ["true", "1", "yes", "y"].includes(String(v).trim().toLowerCase());
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

async function downloadAllAssetsFromAlpaca(): Promise<AlpacaAsset[]> {
  const url = new URL(ASSETS_URL);
  url.searchParams.set("status", "active");
  url.searchParams.set("asset_class", "us_equity");

  const res = await fetchWithRetry(url.toString(), tradingHeaders(), "download assets");
  const assets = (await res.json()) as AlpacaAsset[];

  return assets;
}

function saveAssetsCsv(assets: AlpacaAsset[]): void {
  const headers = [
    "id",
    "class",
    "exchange",
    "symbol",
    "name",
    "status",
    "tradable",
    "marginable",
    "maintenance_margin_requirement",
    "margin_requirement_long",
    "margin_requirement_short",
    "shortable",
    "easy_to_borrow",
    "fractionable",
  ];

  const rows = assets.map((a) => [
    a.id ?? "",
    a.class ?? "",
    a.exchange ?? "",
    a.symbol ?? "",
    a.name ?? "",
    a.status ?? "",
    a.tradable ?? "",
    a.marginable ?? "",
    a.maintenance_margin_requirement ?? "",
    a.margin_requirement_long ?? "",
    a.margin_requirement_short ?? "",
    a.shortable ?? "",
    a.easy_to_borrow ?? "",
    a.fractionable ?? "",
  ]);

  writeCsv(ASSETS_CSV_PATH, headers, rows);
}

function parseAssetsCsv(filePath: string): AlpacaAsset[] {
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return [];

  const lines = raw.split(/\r?\n/);
  if (lines.length <= 1) return [];

  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);

    return {
      id: cols[0] ?? "",
      class: cols[1] ?? "",
      exchange: cols[2] ?? "",
      symbol: cols[3] ?? "",
      name: cols[4] ?? "",
      status: cols[5] ?? "",
      tradable: parseBooleanLoose(cols[6] ?? ""),
      marginable: parseBooleanLoose(cols[7] ?? ""),
      maintenance_margin_requirement: cols[8] ?? "",
      margin_requirement_long: cols[9] ?? "",
      margin_requirement_short: cols[10] ?? "",
      shortable: parseBooleanLoose(cols[11] ?? ""),
      easy_to_borrow: parseBooleanLoose(cols[12] ?? ""),
      fractionable: parseBooleanLoose(cols[13] ?? ""),
    };
  });
}

async function loadOrCreateAssetsCache(): Promise<AlpacaAsset[]> {
  ensureDir(DATA_DIR);

  if (fs.existsSync(ASSETS_CSV_PATH)) {
    console.log(`Using cached assets CSV: ${ASSETS_CSV_PATH}`);
    return parseAssetsCsv(ASSETS_CSV_PATH);
  }

  console.log("Assets CSV not found. Downloading assets from Alpaca...");
  const assets = await downloadAllAssetsFromAlpaca();
  saveAssetsCsv(assets);
  console.log(`Assets CSV created: ${ASSETS_CSV_PATH}`);
  return assets;
}

function buildUniverseFromAssets(assets: AlpacaAsset[]): string[] {
  const filtered = assets.filter((a) => {
    if (ONLY_ACTIVE && a.status !== "active") return false;
    if (ONLY_US_EQUITY && a.class !== "us_equity") return false;
    if (ONLY_TRADABLE && !a.tradable) return false;
    if (EXCLUDE_OTC_FROM_UNIVERSE && a.exchange === "OTC") return false;
    return true;
  });

  return filtered
    .map((a) => a.symbol?.trim())
    .filter((s): s is string => Boolean(s))
    .sort((a, b) => a.localeCompare(b));
}

async function fetchHistoricalBarsForChunk(
  symbols: string[],
  startDate: string,
  endDate: string,
): Promise<Record<string, AlpacaBar[]>> {
  const merged: Record<string, AlpacaBar[]> = {};
  let pageToken: string | undefined;

  while (true) {
    const url = new URL(BARS_URL);
    url.searchParams.set("symbols", symbols.join(","));
    url.searchParams.set("timeframe", "1Day");
    url.searchParams.set("start", `${startDate}T00:00:00Z`);
    url.searchParams.set("end", `${endDate}T23:59:59Z`);
    url.searchParams.set("adjustment", "split");
    url.searchParams.set("sort", "asc");
    url.searchParams.set("limit", "10000");

    if (pageToken) {
      url.searchParams.set("page_token", pageToken);
    }

    const res = await fetchWithRetry(
      url.toString(),
      marketDataHeaders(),
      `historical bars chunk size=${symbols.length}`,
    );

    const data = (await res.json()) as BarsResponse;

    for (const [symbol, bars] of Object.entries(data.bars || {})) {
      if (!merged[symbol]) merged[symbol] = [];
      merged[symbol] = merged[symbol].concat(bars);
    }

    pageToken = data.next_page_token || undefined;
    if (!pageToken) break;
  }

  return merged;
}

async function fetchSnapshotsForChunk(symbols: string[]): Promise<SnapshotsResponse> {
  const url = new URL(SNAPSHOTS_URL);
  url.searchParams.set("symbols", symbols.join(","));

  const res = await fetchWithRetry(
    url.toString(),
    marketDataHeaders(),
    `snapshots chunk size=${symbols.length}`,
  );

  return (await res.json()) as SnapshotsResponse;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) return;

      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runWorker(),
  );

  await Promise.all(workers);
  return results;
}

function buildDailyHistoryRowsFromHistoricalBars(
  barsBySymbol: Record<string, AlpacaBar[]>,
  fromDate: string,
  toDate: string,
): DailyHistoryRow[] {
  const rows: DailyHistoryRow[] = [];

  for (const [symbol, bars] of Object.entries(barsBySymbol)) {
    for (const bar of bars) {
      const date = getDateOnly(bar.t);
      if (date < fromDate || date > toDate) continue;

      rows.push({
        date,
        symbol,
        open: Number(bar.o ?? 0),
        high: Number(bar.h ?? 0),
        low: Number(bar.l ?? 0),
        close: Number(bar.c ?? 0),
        volume: Number(bar.v ?? 0),
        trade_count: Number(bar.n ?? 0),
        vwap: Number(bar.vw ?? 0),
        source: "historical_bar",
      });
    }
  }

  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.symbol.localeCompare(b.symbol);
  });

  return rows;
}

function buildTodayHistoryRowsFromSnapshots(
  snapshots: SnapshotsResponse,
  todayDate: string,
): DailyHistoryRow[] {
  const rows: DailyHistoryRow[] = [];

  for (const [symbol, item] of Object.entries(snapshots)) {
    const dailyBar = item?.dailyBar;
    if (!dailyBar) continue;

    rows.push({
      date: todayDate,
      symbol,
      open: Number(dailyBar.o ?? 0),
      high: Number(dailyBar.h ?? 0),
      low: Number(dailyBar.l ?? 0),
      close: Number(dailyBar.c ?? 0),
      volume: Number(dailyBar.v ?? 0),
      trade_count: Number(dailyBar.n ?? 0),
      vwap: Number(dailyBar.vw ?? 0),
      source: "snapshot",
    });
  }

  rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return rows;
}

function appendDailyHistoryRowsToCsv(filePath: string, rows: DailyHistoryRow[]): void {
  const header = [
    "date",
    "symbol",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "trade_count",
    "vwap",
    "source",
  ].join(",");

  const lines = rows.map((row) =>
    [
      row.date,
      row.symbol,
      row.open.toFixed(4),
      row.high.toFixed(4),
      row.low.toFixed(4),
      row.close.toFixed(4),
      row.volume,
      row.trade_count,
      row.vwap.toFixed(4),
      row.source,
    ].map(csvEscape).join(","),
  );

  appendTextLines(filePath, header, lines);
}

function buildHistoricalTopGainers(
  barsBySymbol: Record<string, AlpacaBar[]>,
  fromDate: string,
  toDate: string,
): TopGainerRow[] {
  const groupedByDate: Record<string, Omit<TopGainerRow, "rank">[]> = {};

  for (const [symbol, bars] of Object.entries(barsBySymbol)) {
    if (!Array.isArray(bars) || bars.length < 2) continue;

    bars.sort((a, b) => a.t.localeCompare(b.t));

    for (let i = 1; i < bars.length; i++) {
      const prev = bars[i - 1];
      const curr = bars[i];

      const date = getDateOnly(curr.t);
      if (date < fromDate || date > toDate) continue;

      if ((prev.v ?? 0) === 0 || (prev.n ?? 0) === 0) continue;
      if (!Number.isFinite(prev.c) || !Number.isFinite(curr.c) || prev.c <= 0) continue;

      const pctChange = ((curr.c - prev.c) / prev.c) * 100;
      if (!Number.isFinite(pctChange)) continue;

      if (!groupedByDate[date]) groupedByDate[date] = [];

      groupedByDate[date].push({
        date,
        symbol,
        close: curr.c,
        previous_close: prev.c,
        pct_change: pctChange,
        volume: curr.v ?? 0,
        source: "historical_bar",
      });
    }
  }

  const out: TopGainerRow[] = [];

  for (const date of Object.keys(groupedByDate).sort()) {
    const rows = groupedByDate[date]
      .sort((a, b) => {
        if (b.pct_change !== a.pct_change) return b.pct_change - a.pct_change;
        return (b.volume || 0) - (a.volume || 0);
      })
      .slice(0, TOP_N)
      .map((row, idx) => ({
        ...row,
        rank: idx + 1,
      }));

    out.push(...rows);
  }

  return out;
}

function buildTodayTopGainersFromSnapshots(
  snapshots: SnapshotsResponse,
  todayDate: string,
): TopGainerRow[] {
  const rows: Omit<TopGainerRow, "rank">[] = [];

  for (const [symbol, item] of Object.entries(snapshots)) {
    const dailyBar = item?.dailyBar;
    const prevDailyBar = item?.prevDailyBar;

    if (!dailyBar || !prevDailyBar) continue;
    if (!Number.isFinite(dailyBar.c) || !Number.isFinite(prevDailyBar.c) || prevDailyBar.c <= 0) {
      continue;
    }

    const pctChange = ((dailyBar.c - prevDailyBar.c) / prevDailyBar.c) * 100;
    if (!Number.isFinite(pctChange)) continue;

    rows.push({
      date: todayDate,
      symbol,
      close: dailyBar.c,
      previous_close: prevDailyBar.c,
      pct_change: pctChange,
      volume: dailyBar.v ?? 0,
      source: "snapshot",
    });
  }

  return rows
    .sort((a, b) => {
      if (b.pct_change !== a.pct_change) return b.pct_change - a.pct_change;
      return (b.volume || 0) - (a.volume || 0);
    })
    .slice(0, TOP_N)
    .map((row, idx) => ({
      ...row,
      rank: idx + 1,
    }));
}

function buildHistoricalTopGappers(
  barsBySymbol: Record<string, AlpacaBar[]>,
  fromDate: string,
  toDate: string,
): TopGapperRow[] {
  const groupedByDate: Record<string, Omit<TopGapperRow, "rank">[]> = {};

  for (const [symbol, bars] of Object.entries(barsBySymbol)) {
    if (!Array.isArray(bars) || bars.length < 2) continue;

    bars.sort((a, b) => a.t.localeCompare(b.t));

    for (let i = 1; i < bars.length; i++) {
      const prev = bars[i - 1];
      const curr = bars[i];

      const date = getDateOnly(curr.t);
      if (date < fromDate || date > toDate) continue;
      if ((prev.v ?? 0) === 0 || (prev.n ?? 0) === 0) continue;
      if (!Number.isFinite(prev.c) || !Number.isFinite(curr.o) || prev.c <= 0) continue;

      const gapPct = ((curr.o - prev.c) / prev.c) * 100;
      if (!Number.isFinite(gapPct)) continue;

      if (!groupedByDate[date]) groupedByDate[date] = [];

      groupedByDate[date].push({
        date,
        symbol,
        open: curr.o,
        previous_close: prev.c,
        gap_pct: gapPct,
        close: curr.c ?? 0,
        volume: curr.v ?? 0,
        source: "historical_bar",
      });
    }
  }

  const out: TopGapperRow[] = [];

  for (const date of Object.keys(groupedByDate).sort()) {
    const rows = groupedByDate[date]
      .sort((a, b) => {
        if (b.gap_pct !== a.gap_pct) return b.gap_pct - a.gap_pct;
        return (b.volume || 0) - (a.volume || 0);
      })
      .slice(0, TOP_N)
      .map((row, idx) => ({
        ...row,
        rank: idx + 1,
      }));

    out.push(...rows);
  }

  return out;
}

function buildTodayTopGappersFromSnapshots(
  snapshots: SnapshotsResponse,
  todayDate: string,
): TopGapperRow[] {
  const rows: Omit<TopGapperRow, "rank">[] = [];

  for (const [symbol, item] of Object.entries(snapshots)) {
    const dailyBar = item?.dailyBar;
    const prevDailyBar = item?.prevDailyBar;

    if (!dailyBar || !prevDailyBar) continue;
    if (!Number.isFinite(dailyBar.o) || !Number.isFinite(prevDailyBar.c) || prevDailyBar.c <= 0) {
      continue;
    }

    const gapPct = ((dailyBar.o - prevDailyBar.c) / prevDailyBar.c) * 100;
    if (!Number.isFinite(gapPct)) continue;

    rows.push({
      date: todayDate,
      symbol,
      open: dailyBar.o,
      previous_close: prevDailyBar.c,
      gap_pct: gapPct,
      close: dailyBar.c ?? 0,
      volume: dailyBar.v ?? 0,
      source: "snapshot",
    });
  }

  return rows
    .sort((a, b) => {
      if (b.gap_pct !== a.gap_pct) return b.gap_pct - a.gap_pct;
      return (b.volume || 0) - (a.volume || 0);
    })
    .slice(0, TOP_N)
    .map((row, idx) => ({
      ...row,
      rank: idx + 1,
    }));
}

function buildHistoricalTopHighOfDay(
  barsBySymbol: Record<string, AlpacaBar[]>,
  fromDate: string,
  toDate: string,
): TopHighOfDayRow[] {
  const groupedByDate: Record<string, Omit<TopHighOfDayRow, "rank">[]> = {};

  for (const [symbol, bars] of Object.entries(barsBySymbol)) {
    if (!Array.isArray(bars) || bars.length < 2) continue;

    bars.sort((a, b) => a.t.localeCompare(b.t));

    for (let i = 1; i < bars.length; i++) {
      const prev = bars[i - 1];
      const curr = bars[i];

      const date = getDateOnly(curr.t);
      if (date < fromDate || date > toDate) continue;

      if ((prev.v ?? 0) === 0 || (prev.n ?? 0) === 0) continue;
      if (!Number.isFinite(prev.c) || !Number.isFinite(curr.h) || prev.c <= 0) continue;

      const highDayPct = ((curr.h - prev.c) / prev.c) * 100;
      if (!Number.isFinite(highDayPct)) continue;

      if (!groupedByDate[date]) groupedByDate[date] = [];

      groupedByDate[date].push({
        date,
        symbol,
        open: curr.o ?? 0,
        high: curr.h ?? 0,
        low: curr.l ?? 0,
        close: curr.c ?? 0,
        previous_close: prev.c,
        high_day_pct: highDayPct,
        volume: curr.v ?? 0,
        source: "historical_bar",
      });
    }
  }

  const out: TopHighOfDayRow[] = [];

  for (const date of Object.keys(groupedByDate).sort()) {
    const rows = groupedByDate[date]
      .sort((a, b) => {
        if (b.high_day_pct !== a.high_day_pct) return b.high_day_pct - a.high_day_pct;
        return (b.volume || 0) - (a.volume || 0);
      })
      .slice(0, TOP_N)
      .map((row, idx) => ({
        ...row,
        rank: idx + 1,
      }));

    out.push(...rows);
  }

  return out;
}

function buildTodayTopHighOfDayFromSnapshots(
  snapshots: SnapshotsResponse,
  todayDate: string,
): TopHighOfDayRow[] {
  const rows: Omit<TopHighOfDayRow, "rank">[] = [];

  for (const [symbol, item] of Object.entries(snapshots)) {
    const dailyBar = item?.dailyBar;
    const prevDailyBar = item?.prevDailyBar;

    if (!dailyBar || !prevDailyBar) continue;
    if (!Number.isFinite(dailyBar.h) || !Number.isFinite(prevDailyBar.c) || prevDailyBar.c <= 0) {
      continue;
    }

    const highDayPct = ((dailyBar.h - prevDailyBar.c) / prevDailyBar.c) * 100;
    if (!Number.isFinite(highDayPct)) continue;

    rows.push({
      date: todayDate,
      symbol,
      open: dailyBar.o ?? 0,
      high: dailyBar.h ?? 0,
      low: dailyBar.l ?? 0,
      close: dailyBar.c ?? 0,
      previous_close: prevDailyBar.c,
      high_day_pct: highDayPct,
      volume: dailyBar.v ?? 0,
      source: "snapshot",
    });
  }

  return rows
    .sort((a, b) => {
      if (b.high_day_pct !== a.high_day_pct) return b.high_day_pct - a.high_day_pct;
      return (b.volume || 0) - (a.volume || 0);
    })
    .slice(0, TOP_N)
    .map((row, idx) => ({
      ...row,
      rank: idx + 1,
    }));
}

function getOrCreateDailyBucket(map: Map<string, DailyTopBuckets>, date: string): DailyTopBuckets {
  let bucket = map.get(date);
  if (!bucket) {
    bucket = {
      gainers: [],
      gappers: [],
      highs: [],
    };
    map.set(date, bucket);
  }
  return bucket;
}

function mergeTopRowsByDate<T extends { date: string }>(
  store: Map<string, T[]>,
  incoming: T[],
  sortFn: (a: T, b: T) => number,
  topN: number,
): void {
  const grouped = new Map<string, T[]>();

  for (const row of incoming) {
    const arr = grouped.get(row.date) ?? [];
    arr.push(row);
    grouped.set(row.date, arr);
  }

  for (const [date, rows] of grouped.entries()) {
    const existing = store.get(date) ?? [];
    const merged = existing.concat(rows).sort(sortFn).slice(0, topN);
    store.set(date, merged);
  }
}

function sortTopGainerRows(a: TopGainerRow, b: TopGainerRow): number {
  if (b.pct_change !== a.pct_change) return b.pct_change - a.pct_change;
  return (b.volume || 0) - (a.volume || 0);
}

function sortTopGapperRows(a: TopGapperRow, b: TopGapperRow): number {
  if (b.gap_pct !== a.gap_pct) return b.gap_pct - a.gap_pct;
  return (b.volume || 0) - (a.volume || 0);
}

function sortTopHighRows(a: TopHighOfDayRow, b: TopHighOfDayRow): number {
  if (b.high_day_pct !== a.high_day_pct) return b.high_day_pct - a.high_day_pct;
  return (b.volume || 0) - (a.volume || 0);
}

function assignGainerRanks(rows: TopGainerRow[]): TopGainerRow[] {
  return rows
    .slice()
    .sort(sortTopGainerRows)
    .map((row, idx) => ({ ...row, rank: idx + 1 }));
}

function assignGapperRanks(rows: TopGapperRow[]): TopGapperRow[] {
  return rows
    .slice()
    .sort(sortTopGapperRows)
    .map((row, idx) => ({ ...row, rank: idx + 1 }));
}

function assignHighRanks(rows: TopHighOfDayRow[]): TopHighOfDayRow[] {
  return rows
    .slice()
    .sort(sortTopHighRows)
    .map((row, idx) => ({ ...row, rank: idx + 1 }));
}

function appendTopGainersRowsToCsv(filePath: string, rows: TopGainerRow[]): void {
  const header = [
    "date",
    "rank",
    "symbol",
    "close",
    "previous_close",
    "pct_change",
    "volume",
    "source",
  ].join(",");

  const lines = rows.map((row) =>
    [
      row.date,
      row.rank,
      row.symbol,
      row.close.toFixed(4),
      row.previous_close.toFixed(4),
      row.pct_change.toFixed(4),
      row.volume,
      row.source,
    ].map(csvEscape).join(","),
  );

  appendTextLines(filePath, header, lines);
}

function appendTopGappersRowsToCsv(filePath: string, rows: TopGapperRow[]): void {
  const header = [
    "date",
    "rank",
    "symbol",
    "open",
    "previous_close",
    "gap_pct",
    "close",
    "volume",
    "source",
  ].join(",");

  const lines = rows.map((row) =>
    [
      row.date,
      row.rank,
      row.symbol,
      row.open.toFixed(4),
      row.previous_close.toFixed(4),
      row.gap_pct.toFixed(4),
      row.close.toFixed(4),
      row.volume,
      row.source,
    ].map(csvEscape).join(","),
  );

  appendTextLines(filePath, header, lines);
}

function appendTopHighOfDayRowsToCsv(filePath: string, rows: TopHighOfDayRow[]): void {
  const header = [
    "date",
    "rank",
    "symbol",
    "open",
    "high",
    "low",
    "close",
    "previous_close",
    "high_day_pct",
    "volume",
    "source",
  ].join(",");

  const lines = rows.map((row) =>
    [
      row.date,
      row.rank,
      row.symbol,
      row.open.toFixed(4),
      row.high.toFixed(4),
      row.low.toFixed(4),
      row.close.toFixed(4),
      row.previous_close.toFixed(4),
      row.high_day_pct.toFixed(4),
      row.volume,
      row.source,
    ].map(csvEscape).join(","),
  );

  appendTextLines(filePath, header, lines);
}

function appendCombinedDailyLeadersRowsToCsv(
  filePath: string,
  rows: CombinedDailyLeaderRow[],
): void {
  const header = [
    "date",
    "symbol",
    "open",
    "high",
    "low",
    "close",
    "previous_close",
    "gap_pct",
    "high_day_pct",
    "close_pct",
    "volume",
    "source",
  ].join(",");

  const lines = rows.map((row) =>
    [
      row.date,
      row.symbol,
      row.open.toFixed(4),
      row.high.toFixed(4),
      row.low.toFixed(4),
      row.close.toFixed(4),
      row.previous_close.toFixed(4),
      row.gap_pct.toFixed(4),
      row.high_day_pct.toFixed(4),
      row.close_pct.toFixed(4),
      row.volume,
      row.source,
    ].map(csvEscape).join(","),
  );

  appendTextLines(filePath, header, lines);
}

function buildCombinedDailyLeadersFromTopBuckets(
  gainersByDate: Map<string, TopGainerRow[]>,
  gappersByDate: Map<string, TopGapperRow[]>,
  highsByDate: Map<string, TopHighOfDayRow[]>,
): CombinedDailyLeaderRow[] {
  const allDates = new Set<string>([
    ...gainersByDate.keys(),
    ...gappersByDate.keys(),
    ...highsByDate.keys(),
  ]);

  const out: CombinedDailyLeaderRow[] = [];

  for (const date of [...allDates].sort()) {
    const dedup = new Map<string, CombinedDailyLeaderRow>();

    for (const row of gappersByDate.get(date) ?? []) {
      const existing = dedup.get(row.symbol);
      dedup.set(row.symbol, {
        date: row.date,
        symbol: row.symbol,
        open: row.open,
        high: existing?.high ?? row.close,
        low: existing?.low ?? row.close,
        close: row.close,
        previous_close: row.previous_close,
        gap_pct: row.gap_pct,
        high_day_pct: existing?.high_day_pct ?? 0,
        close_pct: existing?.close_pct ?? 0,
        volume: Math.max(existing?.volume ?? 0, row.volume ?? 0),
        source: row.source,
      });
    }

    for (const row of highsByDate.get(date) ?? []) {
      const existing = dedup.get(row.symbol);
      dedup.set(row.symbol, {
        date: row.date,
        symbol: row.symbol,
        open: existing?.open ?? row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        previous_close: row.previous_close,
        gap_pct: existing?.gap_pct ?? 0,
        high_day_pct: row.high_day_pct,
        close_pct: existing?.close_pct ?? 0,
        volume: Math.max(existing?.volume ?? 0, row.volume ?? 0),
        source: row.source,
      });
    }

    for (const row of gainersByDate.get(date) ?? []) {
      const existing = dedup.get(row.symbol);
      dedup.set(row.symbol, {
        date: row.date,
        symbol: row.symbol,
        open: existing?.open ?? row.close,
        high: existing?.high ?? row.close,
        low: existing?.low ?? row.close,
        close: row.close,
        previous_close: row.previous_close,
        gap_pct: existing?.gap_pct ?? 0,
        high_day_pct: existing?.high_day_pct ?? 0,
        close_pct: row.pct_change,
        volume: Math.max(existing?.volume ?? 0, row.volume ?? 0),
        source: row.source,
      });
    }

    const mergedRows = [...dedup.values()].sort((a, b) => {
      const aBest = Math.max(a.gap_pct, a.high_day_pct, a.close_pct);
      const bBest = Math.max(b.gap_pct, b.high_day_pct, b.close_pct);
      if (bBest !== aBest) return bBest - aBest;
      return (b.volume || 0) - (a.volume || 0);
    });

    out.push(...mergedRows);
  }

  return out;
}

function buildTopLeadersJson(rows: CombinedDailyLeaderRow[]): TopLeaderJsonRow[] {
  return rows.map((row) => ({
    symbol: row.symbol,
    Date: row.date,
    percent_gain: round4(row.high_day_pct),
    Volume: Number(row.volume ?? 0),
    High: round4(row.high),
  }));
}

function writeTopLeadersJson(filePath: string, rows: TopLeaderJsonRow[]): void {
  const stream = fs.createWriteStream(filePath, { flags: "w" });
  stream.write("[\n");

  rows.forEach((row, idx) => {
    const prefix = idx === 0 ? "  " : ",\n  ";
    stream.write(prefix + JSON.stringify(row));
  });

  stream.write("\n]\n");
  stream.end();
}

function exampleBarsUrlForPostman(symbol: string, startDate: string, endDate: string): string {
  const url = new URL(BARS_URL);
  url.searchParams.set("symbols", symbol);
  url.searchParams.set("timeframe", "1Day");
  url.searchParams.set("start", `${startDate}T00:00:00Z`);
  url.searchParams.set("end", `${endDate}T23:59:59Z`);
  url.searchParams.set("adjustment", "raw");
  url.searchParams.set("sort", "asc");
  url.searchParams.set("limit", "10000");
  return url.toString();
}

function logMemory(prefix: string): void {
  const mem = process.memoryUsage();
  console.log(
    `${prefix} rss=${Math.round(mem.rss / 1024 / 1024)}MB heapUsed=${Math.round(
      mem.heapUsed / 1024 / 1024,
    )}MB heapTotal=${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
  );
}

async function main(): Promise<void> {
  validateConfig();
  ensureDir(DATA_DIR);
  resetOutputFiles();

  const today = todayYYYYMMDD();
  const includeToday = DATA_TO_DATE >= today && DATA_FROM_DATE <= today;

  console.log("======================================");
  console.log(" Alpaca Daily Gainers + Gappers");
  console.log("======================================");
  console.log(`DATA_FROM_DATE:            ${DATA_FROM_DATE}`);
  console.log(`DATA_TO_DATE:              ${DATA_TO_DATE}`);
  console.log(`TODAY:                     ${today}`);
  console.log(`INCLUDE_TODAY:             ${includeToday}`);
  console.log(`DATA_DIR:                  ${DATA_DIR}`);
  console.log(`ASSETS_CSV_PATH:           ${ASSETS_CSV_PATH}`);
  console.log(`DAILY_HISTORY_CSV_PATH:    ${DAILY_HISTORY_CSV_PATH}`);
  console.log(`TOP_GAINERS_CSV_PATH:      ${TOP_GAINERS_CSV_PATH}`);
  console.log(`TOP_GAPPERS_CSV_PATH:      ${TOP_GAPPERS_CSV_PATH}`);
  console.log(`TOP_HIGH_OF_DAY_CSV_PATH:  ${TOP_HIGH_OF_DAY_CSV_PATH}`);
  console.log(`TOP_COMBINED_DAILY_PATH:   ${TOP_COMBINED_DAILY_LEADERS_CSV_PATH}`);
  console.log(`TOP_LEADERS_JSON_PATH:     ${TOP_LEADERS_JSON_PATH}`);
  console.log(`CHUNK_SIZE:                ${CHUNK_SIZE}`);
  console.log(`CHUNK_CONCURRENCY:         ${CHUNK_CONCURRENCY}`);
  console.log(`TOP_N:                     ${TOP_N}`);
  console.log(`REWRITE_OUTPUTS:           ${REWRITE_OUTPUTS}`);
  console.log("");

  const assets = await loadOrCreateAssetsCache();
  console.log(`Assets loaded: ${assets.length}`);

  const universe = buildUniverseFromAssets(assets);
  console.log(`Universe size after code filters: ${universe.length}`);

  if (!universe.length) {
    throw new Error("Universe is empty after filtering.");
  }

  const chunks = chunkArray(universe, CHUNK_SIZE);

  const gainersByDate = new Map<string, TopGainerRow[]>();
  const gappersByDate = new Map<string, TopGapperRow[]>();
  const highsByDate = new Map<string, TopHighOfDayRow[]>();

  let dailyHistoryCount = 0;

  const historicalTo = includeToday ? minusCalendarDays(today, 1) : DATA_TO_DATE;
  const historicalNeeded = DATA_FROM_DATE <= historicalTo;

  if (historicalNeeded) {
    const paddedStart = minusCalendarDays(DATA_FROM_DATE, 10);

    await mapWithConcurrency(
      chunks,
      CHUNK_CONCURRENCY,
      async (chunk, index) => {
        console.log(`Historical bars chunk ${index + 1}/${chunks.length} (${chunk.length} symbols)`);

        const barsBySymbol = await fetchHistoricalBarsForChunk(chunk, paddedStart, historicalTo);

        const historyFromBars = buildDailyHistoryRowsFromHistoricalBars(
          barsBySymbol,
          DATA_FROM_DATE,
          historicalTo,
        );
        if (historyFromBars.length) {
          appendDailyHistoryRowsToCsv(DAILY_HISTORY_CSV_PATH, historyFromBars);
          dailyHistoryCount += historyFromBars.length;
        }

        const gainersFromBars = buildHistoricalTopGainers(
          barsBySymbol,
          DATA_FROM_DATE,
          historicalTo,
        );
        const gappersFromBars = buildHistoricalTopGappers(
          barsBySymbol,
          DATA_FROM_DATE,
          historicalTo,
        );
        const highOfDayFromBars = buildHistoricalTopHighOfDay(
          barsBySymbol,
          DATA_FROM_DATE,
          historicalTo,
        );

        mergeTopRowsByDate(gainersByDate, gainersFromBars, sortTopGainerRows, TOP_N);
        mergeTopRowsByDate(gappersByDate, gappersFromBars, sortTopGapperRows, TOP_N);
        mergeTopRowsByDate(highsByDate, highOfDayFromBars, sortTopHighRows, TOP_N);

        logMemory(`After historical chunk ${index + 1}/${chunks.length}`);
      },
    );
  }

  if (includeToday) {
    await mapWithConcurrency(
      chunks,
      CHUNK_CONCURRENCY,
      async (chunk, index) => {
        console.log(`Snapshots chunk ${index + 1}/${chunks.length} (${chunk.length} symbols)`);

        const snapshots = await fetchSnapshotsForChunk(chunk);

        const todayHistory = buildTodayHistoryRowsFromSnapshots(snapshots, today);
        if (todayHistory.length) {
          appendDailyHistoryRowsToCsv(DAILY_HISTORY_CSV_PATH, todayHistory);
          dailyHistoryCount += todayHistory.length;
        }

        const todayGainers = buildTodayTopGainersFromSnapshots(snapshots, today);
        const todayGappers = buildTodayTopGappersFromSnapshots(snapshots, today);
        const todayHighOfDay = buildTodayTopHighOfDayFromSnapshots(snapshots, today);

        mergeTopRowsByDate(gainersByDate, todayGainers, sortTopGainerRows, TOP_N);
        mergeTopRowsByDate(gappersByDate, todayGappers, sortTopGapperRows, TOP_N);
        mergeTopRowsByDate(highsByDate, todayHighOfDay, sortTopHighRows, TOP_N);

        logMemory(`After snapshots chunk ${index + 1}/${chunks.length}`);
      },
    );
  }

  const topGainersRows = [...gainersByDate.keys()]
    .sort()
    .flatMap((date) => assignGainerRanks(gainersByDate.get(date) ?? []));

  const topGappersRows = [...gappersByDate.keys()]
    .sort()
    .flatMap((date) => assignGapperRanks(gappersByDate.get(date) ?? []));

  const topHighOfDayRows = [...highsByDate.keys()]
    .sort()
    .flatMap((date) => assignHighRanks(highsByDate.get(date) ?? []));

  if (topGainersRows.length) {
    appendTopGainersRowsToCsv(TOP_GAINERS_CSV_PATH, topGainersRows);
  }

  if (topGappersRows.length) {
    appendTopGappersRowsToCsv(TOP_GAPPERS_CSV_PATH, topGappersRows);
  }

  if (topHighOfDayRows.length) {
    appendTopHighOfDayRowsToCsv(TOP_HIGH_OF_DAY_CSV_PATH, topHighOfDayRows);
  }

  const combinedDailyLeaderRows = buildCombinedDailyLeadersFromTopBuckets(
    gainersByDate,
    gappersByDate,
    highsByDate,
  );

  if (combinedDailyLeaderRows.length) {
    appendCombinedDailyLeadersRowsToCsv(
      TOP_COMBINED_DAILY_LEADERS_CSV_PATH,
      combinedDailyLeaderRows,
    );
  }

  const topLeadersJson = buildTopLeadersJson(combinedDailyLeaderRows);
  writeTopLeadersJson(TOP_LEADERS_JSON_PATH, topLeadersJson);

  console.log("");
  console.log(`Daily history rows written:       ${dailyHistoryCount}`);
  console.log(`Top gainers rows written:         ${topGainersRows.length}`);
  console.log(`Top gappers rows written:         ${topGappersRows.length}`);
  console.log(`Top high-of-day rows written:     ${topHighOfDayRows.length}`);
  console.log(`Combined daily leaders rows:      ${combinedDailyLeaderRows.length}`);
  console.log(`Top leaders JSON rows written:    ${topLeadersJson.length}`);
  console.log("");
  console.log("Example Postman URL for daily bars:");
  console.log(exampleBarsUrlForPostman("AAPL", DATA_FROM_DATE, DATA_TO_DATE));
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
});