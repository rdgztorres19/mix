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
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var FundamentalCacheService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FundamentalCacheService = void 0;
const common_1 = require("@nestjs/common");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const axios_1 = __importDefault(require("axios"));
const mysql_training_repository_1 = require("../scanner/mysql/mysql-training.repository");
const EMPTY = { sharesOutstanding: null, marketCap: null };
function resolveStockProfileCsvPath() {
    const override = process.env.STOCK_PROFILE_CSV_PATH?.trim();
    if (override)
        return path.resolve(override);
    return path.resolve(process.cwd(), '..', 'stock-training', 'data', 'stock_profile.csv');
}
function parseStockProfileCsv(filePath) {
    if (!fs.existsSync(filePath))
        return [];
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length < 2)
        return [];
    const out = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        const symbol = (parts[0] ?? '').trim().toUpperCase();
        if (!symbol)
            continue;
        const soRaw = (parts[1] ?? '').trim();
        const mcRaw = (parts[2] ?? '').trim();
        const soNum = soRaw === '' ? NaN : parseFloat(soRaw);
        const mcNum = mcRaw === '' ? NaN : parseFloat(mcRaw);
        out.push({
            symbol,
            sharesOutstanding: !isNaN(soNum) && soNum > 0 ? soNum : null,
            marketCap: !isNaN(mcNum) && mcNum > 0 ? mcNum : null,
        });
    }
    return out;
}
let FundamentalCacheService = FundamentalCacheService_1 = class FundamentalCacheService {
    constructor(mysqlRepo) {
        this.mysqlRepo = mysqlRepo;
        this.logger = new common_1.Logger(FundamentalCacheService_1.name);
        this.cache = new Map();
        this.envLoaded = false;
    }
    async onModuleInit() {
        await this.mysqlRepo.ensureStockProfileTable();
        const count = await this.mysqlRepo.countStockProfileRows();
        const csvPath = resolveStockProfileCsvPath();
        const csvRows = parseStockProfileCsv(csvPath);
        if (count === 0 && csvRows.length > 0) {
            await this.mysqlRepo.bulkReplaceStockProfiles(csvRows);
            this.logger.log(`Seeded stock_profile from CSV (${csvRows.length} rows) → ${csvPath}`);
        }
        else if (count === 0 && csvRows.length === 0) {
            this.logger.warn(`stock_profile empty and no CSV at ${csvPath}; fundamentals will use Finnhub only`);
        }
        let loaded = await this.mysqlRepo.loadAllStockProfiles();
        if (loaded.size === 0 && csvRows.length > 0) {
            for (const r of csvRows) {
                loaded.set(r.symbol, { sharesOutstanding: r.sharesOutstanding, marketCap: r.marketCap });
            }
            this.logger.log(`Fundamentals: loaded ${csvRows.length} symbols from CSV (MySQL empty or unavailable)`);
        }
        for (const [sym, v] of loaded) {
            this.cache.set(sym, v);
        }
        this.logger.log(`Fundamentals cache ready: ${this.cache.size} symbols`);
    }
    ensureFinnhubKeyLoaded() {
        if (this.envLoaded || process.env.FINNHUB_API_KEY)
            return;
        this.envLoaded = true;
        try {
            const dotenv = require('dotenv');
            const stockTrainingEnv = path.resolve(process.cwd(), '..', 'stock-training', '.env');
            dotenv.config({ path: stockTrainingEnv });
        }
        catch {
        }
    }
    async fetchFromFinnhub(ticker, token) {
        const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${token}`;
        const res = await axios_1.default.get(url, { timeout: 8000 });
        const profile = res.data ?? {};
        const so = profile.shareOutstanding ?? profile.share_outstanding;
        const soNum = typeof so === 'number' ? so : typeof so === 'string' ? parseFloat(so) : NaN;
        const sharesOutstanding = !isNaN(soNum) && soNum > 0 ? soNum * 1_000_000 : null;
        const mc = profile.marketCapitalization ?? profile.market_capitalization;
        const mcNum = typeof mc === 'number' ? mc : typeof mc === 'string' ? parseFloat(mc) : NaN;
        const marketCap = !isNaN(mcNum) && mcNum > 0 ? mcNum : null;
        return { sharesOutstanding, marketCap };
    }
    async getFundamentals(symbol) {
        const key = symbol.toUpperCase();
        if (this.cache.has(key)) {
            return this.cache.get(key);
        }
        this.ensureFinnhubKeyLoaded();
        const token = process.env.FINNHUB_API_KEY?.trim();
        if (!token) {
            this.cache.set(key, EMPTY);
            return EMPTY;
        }
        try {
            const result = await this.fetchFromFinnhub(key, token);
            this.cache.set(key, result);
            if (result.sharesOutstanding != null || result.marketCap != null) {
                await this.mysqlRepo.upsertStockProfile(key, result.sharesOutstanding, result.marketCap);
            }
            return result;
        }
        catch (err) {
            if (axios_1.default.isAxiosError(err) && err.response?.status === 429)
                throw err;
            this.cache.set(key, EMPTY);
            return EMPTY;
        }
    }
};
exports.FundamentalCacheService = FundamentalCacheService;
exports.FundamentalCacheService = FundamentalCacheService = FundamentalCacheService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [mysql_training_repository_1.MysqlTrainingRepository])
], FundamentalCacheService);
//# sourceMappingURL=fundamental-cache.service.js.map