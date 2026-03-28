import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as zlib from 'zlib';
import { promisify } from 'util';
import path from 'path';
import type { AlpacaBar } from '../../scanner/screener/alpaca/alpaca-screener.client';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const DATA_ROOT = path.resolve(__dirname, '../../../data');

export function dataDir(date: string): string {
  return path.join(DATA_ROOT, date);
}

export function barsPath(date: string): string {
  return path.join(DATA_ROOT, date, 'bars-1m.json.gz');
}

export function prevClosePath(date: string): string {
  return path.join(DATA_ROOT, date, 'prev-close.json.gz');
}

export async function hasLocalData(date: string): Promise<boolean> {
  try {
    await fsp.access(barsPath(date), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readLocalBars(date: string): Promise<Map<string, AlpacaBar[]>> {
  const buf = await fsp.readFile(barsPath(date));
  const json = (await gunzip(buf)).toString('utf-8');
  const obj = JSON.parse(json) as Record<string, AlpacaBar[]>;
  const map = new Map<string, AlpacaBar[]>();
  for (const [sym, bars] of Object.entries(obj)) {
    map.set(sym, bars);
  }
  return map;
}

export async function writeLocalBars(date: string, bars: Map<string, AlpacaBar[]>): Promise<void> {
  await fsp.mkdir(dataDir(date), { recursive: true });
  const obj: Record<string, AlpacaBar[]> = {};
  bars.forEach((barArr, sym) => {
    obj[sym] = barArr;
  });
  const compressed = await gzip(Buffer.from(JSON.stringify(obj), 'utf-8'));
  await fsp.writeFile(barsPath(date), compressed);
}

export async function readLocalPrevClose(date: string): Promise<Map<string, number>> {
  const buf = await fsp.readFile(prevClosePath(date));
  const json = (await gunzip(buf)).toString('utf-8');
  const obj = JSON.parse(json) as Record<string, number>;
  const map = new Map<string, number>();
  for (const [sym, val] of Object.entries(obj)) {
    map.set(sym, val);
  }
  return map;
}

export async function writeLocalPrevClose(date: string, map: Map<string, number>): Promise<void> {
  await fsp.mkdir(dataDir(date), { recursive: true });
  const obj: Record<string, number> = {};
  map.forEach((val, sym) => {
    obj[sym] = val;
  });
  const compressed = await gzip(Buffer.from(JSON.stringify(obj), 'utf-8'));
  await fsp.writeFile(prevClosePath(date), compressed);
}
