import Redis from 'ioredis';
import * as zlib from 'zlib';
import { promisify } from 'util';
import type { AlpacaBar } from '../../scanner/screener/alpaca/alpaca-screener.client';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const TTL_SECONDS = 86_400; // 1 day

function redisKey(date: string): string {
  return `backtest:1m:bars:${date}`;
}

export async function connectRedis(): Promise<Redis> {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  const redis = new Redis(url, { lazyConnect: true, connectTimeout: 5000, maxRetriesPerRequest: 1 });
  await redis.connect();
  return redis;
}

export async function getCachedBars(
  redis: Redis,
  date: string,
): Promise<Map<string, AlpacaBar[]> | null> {
  const buf = await redis.getBuffer(redisKey(date));
  if (!buf) return null;

  const json = (await gunzip(buf)).toString('utf-8');
  const obj = JSON.parse(json) as Record<string, AlpacaBar[]>;
  const map = new Map<string, AlpacaBar[]>();
  for (const [sym, bars] of Object.entries(obj)) {
    map.set(sym, bars);
  }
  return map;
}

export async function setCachedBars(
  redis: Redis,
  date: string,
  bars: Map<string, AlpacaBar[]>,
): Promise<void> {
  const obj: Record<string, AlpacaBar[]> = {};
  bars.forEach((barArr, sym) => {
    obj[sym] = barArr;
  });
  const json = JSON.stringify(obj);
  const compressed = await gzip(Buffer.from(json, 'utf-8'));
  await redis.setex(redisKey(date), TTL_SECONDS, compressed);
}
