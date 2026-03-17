"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var AnalysisLogService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalysisLogService = void 0;
const common_1 = require("@nestjs/common");
const mysql = __importStar(require("mysql2/promise"));
let AnalysisLogService = AnalysisLogService_1 = class AnalysisLogService {
    constructor() {
        this.logger = new common_1.Logger(AnalysisLogService_1.name);
        this.pool = null;
    }
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
        }
        catch (err) {
            this.logger.warn(`Analysis logging disabled: ${err.message}`);
            this.pool = null;
        }
    }
    async insert(entry) {
        if (!this.pool)
            return null;
        try {
            const [result] = await this.pool.execute(`INSERT INTO analysis_logs (
          ticker, account_size, cutoff_ms, request_prompt, messages_json,
          response_json, raw_analysis, tool_calls_count, rag_chunks_used,
          duration_ms, error_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
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
            ]);
            const insertId = result.insertId;
            return insertId ?? null;
        }
        catch (err) {
            this.logger.error(`Failed to insert analysis log: ${err.message}`);
            return null;
        }
    }
    async list(limit = 50, ticker) {
        if (!this.pool)
            return [];
        try {
            const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
            let sql = `
        SELECT id, ticker, account_size, cutoff_ms, request_prompt, messages_json,
               response_json, raw_analysis, tool_calls_count, rag_chunks_used,
               duration_ms, error_text, created_at
        FROM analysis_logs
      `;
            const params = [];
            if (ticker) {
                sql += ' WHERE ticker = ?';
                params.push(ticker.toUpperCase());
            }
            sql += ` ORDER BY created_at DESC LIMIT ${safeLimit}`;
            const [rows] = await this.pool.execute(sql, params);
            return rows.map((r) => ({
                ...r,
                created_at: r.created_at ? new Date(r.created_at) : null,
            }));
        }
        catch (err) {
            this.logger.error(`Failed to list analysis logs: ${err.message}`);
            return [];
        }
    }
    async getById(id) {
        if (!this.pool)
            return null;
        try {
            const [rows] = await this.pool.execute(`SELECT id, ticker, account_size, cutoff_ms, request_prompt, messages_json,
                response_json, raw_analysis, tool_calls_count, rag_chunks_used,
                duration_ms, error_text, created_at
         FROM analysis_logs WHERE id = ?`, [id]);
            const r = rows[0];
            if (!r)
                return null;
            return { ...r, created_at: r.created_at ? new Date(r.created_at) : null };
        }
        catch (err) {
            this.logger.error(`Failed to get analysis log: ${err.message}`);
            return null;
        }
    }
};
exports.AnalysisLogService = AnalysisLogService;
exports.AnalysisLogService = AnalysisLogService = AnalysisLogService_1 = __decorate([
    (0, common_1.Injectable)()
], AnalysisLogService);
//# sourceMappingURL=analysis-log.service.js.map