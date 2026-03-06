import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as mysql from 'mysql2/promise';

export interface AnalysisLogEntry {
  id: number;
  ticker: string;
  account_size: number;
  cutoff_ms: number | null;
  request_prompt: string;
  messages_json: string;
  response_json: string;
  raw_analysis: string;
  tool_calls_count: number;
  rag_chunks_used: number;
  duration_ms: number;
  error_text: string | null;
  created_at: Date;
}

export interface AnalysisLogInsert {
  ticker: string;
  account_size: number;
  cutoff_ms: number | null;
  request_prompt: string;
  messages_json: string;
  response_json: string;
  raw_analysis: string;
  tool_calls_count: number;
  rag_chunks_used: number;
  duration_ms: number;
  error_text?: string | null;
}

@Injectable()
export class AnalysisLogService implements OnModuleInit {
  private readonly logger = new Logger(AnalysisLogService.name);
  private pool: mysql.Pool | null = null;

  async onModuleInit() {
    const host = process.env.MYSQL_HOST || 'localhost';
    const port = parseInt(process.env.MYSQL_PORT || '3306', 10);
    const user = process.env.MYSQL_USER || 'root';
    const password = process.env.MYSQL_PASSWORD || '';
    const database = process.env.MYSQL_DATABASE || 'trading_debug';

    if (!password) {
      this.logger.warn('MYSQL_PASSWORD not set — analysis logging disabled');
      return;
    }

    try {
      // Crear DB si no existe (MySQL no la crea automáticamente)
      const tempConn = await mysql.createConnection({
        host,
        port,
        user,
        password,
      });
      await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
      await tempConn.end();

      this.pool = mysql.createPool({
        host,
        port,
        user,
        password,
        database,
        waitForConnections: true,
        connectionLimit: 5,
      });

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS analysis_logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          ticker VARCHAR(10) NOT NULL,
          account_size INT NOT NULL,
          cutoff_ms BIGINT NULL,
          request_prompt TEXT NOT NULL,
          messages_json LONGTEXT NOT NULL,
          response_json LONGTEXT NOT NULL,
          raw_analysis TEXT NOT NULL,
          tool_calls_count INT NOT NULL DEFAULT 0,
          rag_chunks_used INT NOT NULL DEFAULT 0,
          duration_ms INT NOT NULL,
          error_text TEXT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_ticker (ticker),
          INDEX idx_created_at (created_at)
        )
      `);
      this.logger.log(`Analysis logs → MySQL ${host}:${port}/${database}, tabla analysis_logs OK`);
    } catch (err) {
      this.logger.warn(`Analysis logging disabled: ${err.message}`);
      this.pool = null;
    }
  }

  async insert(entry: AnalysisLogInsert): Promise<number | null> {
    if (!this.pool) return null;

    try {
      const [result] = await this.pool.execute(
        `INSERT INTO analysis_logs (
          ticker, account_size, cutoff_ms, request_prompt, messages_json,
          response_json, raw_analysis, tool_calls_count, rag_chunks_used,
          duration_ms, error_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.ticker,
          entry.account_size,
          entry.cutoff_ms,
          entry.request_prompt,
          entry.messages_json,
          entry.response_json,
          entry.raw_analysis,
          entry.tool_calls_count,
          entry.rag_chunks_used,
          entry.duration_ms,
          entry.error_text ?? null,
        ],
      );
      const insertId = (result as mysql.ResultSetHeader).insertId;
      return insertId ?? null;
    } catch (err) {
      this.logger.error(`Failed to insert analysis log: ${err.message}`);
      return null;
    }
  }

  async list(limit = 50, ticker?: string): Promise<AnalysisLogEntry[]> {
    if (!this.pool) return [];

    try {
      const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
      let sql = `
        SELECT id, ticker, account_size, cutoff_ms, request_prompt, messages_json,
               response_json, raw_analysis, tool_calls_count, rag_chunks_used,
               duration_ms, error_text, created_at
        FROM analysis_logs
      `;
      const params: any[] = [];
      if (ticker) {
        sql += ' WHERE ticker = ?';
        params.push(ticker.toUpperCase());
      }
      sql += ` ORDER BY created_at DESC LIMIT ${safeLimit}`;

      const [rows] = await this.pool.execute(sql, params);
      return (rows as any[]).map((r) => ({
        ...r,
        created_at: r.created_at ? new Date(r.created_at) : null,
      }));
    } catch (err) {
      this.logger.error(`Failed to list analysis logs: ${err.message}`);
      return [];
    }
  }

  async getById(id: number): Promise<AnalysisLogEntry | null> {
    if (!this.pool) return null;

    try {
      const [rows] = await this.pool.execute(
        `SELECT id, ticker, account_size, cutoff_ms, request_prompt, messages_json,
                response_json, raw_analysis, tool_calls_count, rag_chunks_used,
                duration_ms, error_text, created_at
         FROM analysis_logs WHERE id = ?`,
        [id],
      );
      const r = (rows as any[])[0];
      if (!r) return null;
      return { ...r, created_at: r.created_at ? new Date(r.created_at) : null };
    } catch (err) {
      this.logger.error(`Failed to get analysis log: ${err.message}`);
      return null;
    }
  }
}
