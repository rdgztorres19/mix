import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { fetchAlpacaAssets } from './alpaca-assets';
import { AssetsMySQL } from './assets.mysql';
import mysql from 'mysql2/promise';

@Injectable()
export class AssetsService implements OnModuleInit {
  private readonly logger = new Logger(AssetsService.name);
  private mysql: AssetsMySQL;
  private symbols: string[] = [];
  private ready = false;

  async onModuleInit() {
    // Usa la misma config que RankingService
    const pool = mysql.createPool({
      host: 'localhost',
      user: 'root',
      password: 'sbrQp10',
      database: 'stock_training',
      port: 3306,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
    this.mysql = new AssetsMySQL(pool);
    await this.mysql.ensureTable();
    this.symbols = await this.mysql.getAllSymbols();
    this.ready = true;
    this.logger.log(`AssetsService initialized. Loaded ${this.symbols.length} symbols from DB.`);
    if (this.symbols.length === 0) {
      await this.fetchAndPersistAssets();
    }
  }

  async fetchAndPersistAssets() {
    // Debes poner tus claves Alpaca aquí o en env
    const apiKey = process.env.ALPACA_API_KEY_ID || '';
    const apiSecret = process.env.ALPACA_API_SECRET_KEY || '';
    if (!apiKey || !apiSecret) {
      this.logger.error('Alpaca API keys not set');
      return;
    }
    const assets = await fetchAlpacaAssets(apiKey, apiSecret);
    await this.mysql.saveAssets(assets);
    this.symbols = assets.map(a => a.symbol);
    this.logger.log(`Fetched and saved ${assets.length} Alpaca assets.`);
  }

  async getAllSymbols(): Promise<string[]> {
    if (!this.ready) {
      this.logger.warn('AssetsService not ready, returning empty list');
      return [];
    }
    if (this.symbols.length === 0) {
      await this.fetchAndPersistAssets();
    }
    return this.symbols;
  }
}
