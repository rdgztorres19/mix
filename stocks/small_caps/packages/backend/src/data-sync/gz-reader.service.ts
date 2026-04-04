import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as zlib from 'zlib';
import { promisify } from 'util';
import * as path from 'path';

const gunzip = promisify(zlib.gunzip);

export interface RawBar {
  t: string;  // ISO timestamp
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n?: number;
  vw?: number;
}

export interface RawNews {
  id: number;
  headline: string;
  created_at: string;
  symbols: string[];
  source: string;
  summary: string;
}

@Injectable()
export class GzReaderService {
  private readonly dataRoot = process.env.DATA_ROOT ?? '';

  private dataDir(date: string): string {
    return path.join(this.dataRoot, date);
  }

  async hasData(date: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.dataDir(date), 'bars-1m.json.gz'));
      return true;
    } catch {
      return false;
    }
  }

  async readBars(date: string): Promise<Map<string, RawBar[]>> {
    const filePath = path.join(this.dataDir(date), 'bars-1m.json.gz');
    const buf = await fs.readFile(filePath);
    const json = (await gunzip(buf)).toString('utf-8');
    const obj = JSON.parse(json) as Record<string, RawBar[]>;
    const map = new Map<string, RawBar[]>();
    for (const [sym, bars] of Object.entries(obj)) {
      map.set(sym, bars);
    }
    return map;
  }

  async readPrevClose(date: string): Promise<Map<string, number>> {
    const filePath = path.join(this.dataDir(date), 'prev-close.json.gz');
    try {
      const buf = await fs.readFile(filePath);
      const json = (await gunzip(buf)).toString('utf-8');
      const obj = JSON.parse(json) as Record<string, number>;
      const map = new Map<string, number>();
      for (const [sym, val] of Object.entries(obj)) {
        map.set(sym, val);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  async readNews(date: string): Promise<RawNews[]> {
    const filePath = path.join(this.dataDir(date), 'news.json.gz');
    try {
      const buf = await fs.readFile(filePath);
      const json = (await gunzip(buf)).toString('utf-8');
      return JSON.parse(json) as RawNews[];
    } catch {
      return [];
    }
  }

  /** List all available date directories. */
  async listDates(): Promise<string[]> {
    const entries = await fs.readdir(this.dataRoot);
    return entries
      .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e))
      .sort();
  }
}
