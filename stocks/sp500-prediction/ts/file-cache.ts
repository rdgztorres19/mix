import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as zlib from 'zlib';
import { promisify } from 'util';
import path from 'path';
import type { AlpacaBar } from './types';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const DATA_ROOT = path.resolve(__dirname, '../data/raw');

// Per-date directory structure (same pattern as data-downloader)
// data/raw/{date}/bars-1m.json.gz      — 1min bars for SPY
// data/raw/{date}/prev-close.json.gz   — prev close for SPY
// data/raw/{date}/uvxy-1m.json.gz      — 1min bars for UVXY (VIX proxy)

export function dataDir(date: string): string {
  return path.join(DATA_ROOT, date);
}

function barsPath(date: string): string {
  return path.join(DATA_ROOT, date, 'bars-1m.json.gz');
}

function prevClosePath(date: string): string {
  return path.join(DATA_ROOT, date, 'prev-close.json.gz');
}

function uvxyPath(date: string): string {
  return path.join(DATA_ROOT, date, 'uvxy-1m.json.gz');
}

export async function hasLocalData(date: string): Promise<boolean> {
  try {
    await fsp.access(barsPath(date), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readLocalBars(date: string): Promise<AlpacaBar[]> {
  const buf = await fsp.readFile(barsPath(date));
  const json = (await gunzip(buf)).toString('utf-8');
  return JSON.parse(json) as AlpacaBar[];
}

export async function writeLocalBars(date: string, bars: AlpacaBar[]): Promise<void> {
  await fsp.mkdir(dataDir(date), { recursive: true });
  const compressed = await gzip(Buffer.from(JSON.stringify(bars), 'utf-8'));
  await fsp.writeFile(barsPath(date), compressed);
}

export async function readLocalPrevClose(date: string): Promise<number> {
  const buf = await fsp.readFile(prevClosePath(date));
  const json = (await gunzip(buf)).toString('utf-8');
  return JSON.parse(json) as number;
}

export async function writeLocalPrevClose(date: string, prevClose: number): Promise<void> {
  await fsp.mkdir(dataDir(date), { recursive: true });
  const compressed = await gzip(Buffer.from(JSON.stringify(prevClose), 'utf-8'));
  await fsp.writeFile(prevClosePath(date), compressed);
}

// ── UVXY (VIX proxy) ────────────────────────────────────────────────────────

export async function hasLocalUvxy(date: string): Promise<boolean> {
  try {
    await fsp.access(uvxyPath(date), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readLocalUvxy(date: string): Promise<AlpacaBar[]> {
  try {
    const buf = await fsp.readFile(uvxyPath(date));
    const json = (await gunzip(buf)).toString('utf-8');
    return JSON.parse(json) as AlpacaBar[];
  } catch {
    return [];
  }
}

export async function writeLocalUvxy(date: string, bars: AlpacaBar[]): Promise<void> {
  await fsp.mkdir(dataDir(date), { recursive: true });
  const compressed = await gzip(Buffer.from(JSON.stringify(bars), 'utf-8'));
  await fsp.writeFile(uvxyPath(date), compressed);
}
