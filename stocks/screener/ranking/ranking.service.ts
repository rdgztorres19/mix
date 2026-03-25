import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AlpacaBatchService } from '../batch/alpaca-batch.service';
import { AssetsService } from '../assets/assets.service';
import { rankingStore } from './ranking.store-singleton';
import { RankingMySQL } from './ranking.mysql';
import { ensureRankingTables } from './ranking.mysql-init';
import { RankingResult } from './types';

@Injectable()
export class RankingService implements OnModuleInit {
  private readonly logger = new Logger(RankingService.name);
  private mysql: RankingMySQL;
  private mysqlReady = false;

  constructor(
    private readonly alpacaBatch: AlpacaBatchService,
    private readonly assets: AssetsService,
  ) {}

  async onModuleInit() {
    // Configuración fija para MySQL solicitada
    const config = {
      host: 'localhost',
      user: 'root',
      password: 'sbrQp10',
      database: 'stock_training',
      port: 3306,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    };
    this.mysql = new RankingMySQL(config);
    await ensureRankingTables((this.mysql as any).pool);
    this.mysqlReady = true;
    this.logger.log('MySQL pool initialized and tables ensured');
  }

  async getTopGappers() {
    if (rankingStore.getGappers().length > 0) return rankingStore.getGappers();
    if (this.mysqlReady) return this.mysql.getGappers();
    return [];
  }

  async getTopGainers() {
    if (rankingStore.getGainers().length > 0) return rankingStore.getGainers();
    if (this.mysqlReady) return this.mysql.getGainers();
    return [];
  }

  async getCombinedSymbols() {
    if (rankingStore.getCombined().length > 0) return rankingStore.getCombined();
    if (this.mysqlReady) return this.mysql.getCombined();
    return [];
  }

  async syncAllRankings() {
    // 1. Obtener symbols
    const symbols = await this.assets.getAllSymbols();
    if (!symbols.length) throw new Error('No symbols loaded');

    // 2. Obtener claves Alpaca
    const apiKey = process.env.ALPACA_API_KEY_ID || '';
    const apiSecret = process.env.ALPACA_API_SECRET_KEY || '';
    if (!apiKey || !apiSecret) throw new Error('Alpaca API keys not set');

    // 3. Fechas (solo hoy y ayer)
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;
    const yesterday = new Date(today.getTime() - 86400000);
    const yyy = yesterday.getFullYear();
    const ymm = String(yesterday.getMonth() + 1).padStart(2, '0');
    const ydd = String(yesterday.getDate()).padStart(2, '0');
    const yesterdayStr = `${yyy}-${ymm}-${ydd}`;

    // 4. Batch bars (ayer y hoy)
    const { fetchAlpacaBarsBatch } = await import('../batch/alpaca-bars-batch');
    const barsResults = await this.alpacaBatch.fetchBatchData(
      symbols,
      (chunk) => fetchAlpacaBarsBatch(chunk, apiKey, apiSecret, yesterdayStr, todayStr),
      200, 5
    );
    // barsResults: array of { bars: Record<symbol, AlpacaBar[]> }
    const barsBySymbol: Record<string, any[]> = {};
    for (const res of barsResults) {
      if (res && res.bars) {
        for (const [symbol, bars] of Object.entries(res.bars)) {
          barsBySymbol[symbol] = bars;
        }
      }
    }

    // 5. Batch snapshots (hoy)
    const { fetchAlpacaSnapshotsBatch } = await import('../batch/alpaca-snapshots-batch');
    const snapshotsResults = await this.alpacaBatch.fetchBatchData(
      symbols,
      (chunk) => fetchAlpacaSnapshotsBatch(chunk, apiKey, apiSecret),
      200, 5
    );
    // snapshotsResults: array of Record<symbol, AlpacaSnapshotItem>
    const snapshotsBySymbol: Record<string, any> = {};
    for (const res of snapshotsResults) {
      for (const [symbol, snap] of Object.entries(res)) {
        snapshotsBySymbol[symbol] = snap;
      }
    }

    // 6. Calcular gappers y gainers
    const gappers = [];
    const gainers = [];
    for (const symbol of symbols) {
      // Gappers: open hoy vs close ayer
      const bars = barsBySymbol[symbol];
      if (bars && bars.length >= 2) {
        const prev = bars[bars.length - 2];
        const curr = bars[bars.length - 1];
        if (prev && curr && prev.c > 0 && curr.o > 0) {
          const gapPct = ((curr.o - prev.c) / prev.c) * 100;
          gappers.push({
            symbol,
            open: curr.o,
            previousClose: prev.c,
            gapPct,
            volume: curr.v,
            rank: 0,
          });
        }
        // Gainers: close hoy vs close ayer
        if (prev && curr && prev.c > 0 && curr.c > 0) {
          const pctChange = ((curr.c - prev.c) / prev.c) * 100;
          gainers.push({
            symbol,
            close: curr.c,
            previousClose: prev.c,
            pctChange,
            volume: curr.v,
            rank: 0,
          });
        }
      }
    }
    // Ordenar y rankear
    gappers.sort((a, b) => b.gapPct - a.gapPct);
    gainers.sort((a, b) => b.pctChange - a.pctChange);
    gappers.forEach((g, i) => (g.rank = i + 1));
    gainers.forEach((g, i) => (g.rank = i + 1));
    const topGappers = gappers.slice(0, 40);
    const topGainers = gainers.slice(0, 40);
    // Combinado sin duplicados
    const combined = Array.from(new Set([
      ...topGappers.map(g => g.symbol),
      ...topGainers.map(g => g.symbol),
    ])).slice(0, 40);

    const now = new Date().toISOString();
    const result: RankingResult = {
      gappers: topGappers,
      gainers: topGainers,
      combined,
      updatedAt: now,
    };
    rankingStore.set(result);
    if (this.mysqlReady) await this.mysql.saveRanking(result);
    this.logger.log('Syncing all rankings (force/manual)');
    return { status: 'ok', updated: true, updatedAt: now };
  }
}
