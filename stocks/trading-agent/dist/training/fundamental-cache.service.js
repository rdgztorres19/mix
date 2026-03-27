/**
 * Fundamentals: MySQL stock_profile + in-memory Map + Finnhub backfill.
 * Duplicated Finnhub parsing from stock-training fundamental-fetcher — keep in sync.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "FundamentalCacheService", {
    enumerable: true,
    get: function() {
        return FundamentalCacheService;
    }
});
const _common = require("@nestjs/common");
const _nodefs = /*#__PURE__*/ _interop_require_wildcard(require("node:fs"));
const _nodepath = /*#__PURE__*/ _interop_require_wildcard(require("node:path"));
const _axios = /*#__PURE__*/ _interop_require_default(require("axios"));
const _mysqltrainingrepository = require("../scanner/mysql/mysql-training.repository");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
const EMPTY = {
    sharesOutstanding: null,
    marketCap: null
};
function resolveStockProfileCsvPath() {
    const override = process.env.STOCK_PROFILE_CSV_PATH?.trim();
    if (override) return _nodepath.resolve(override);
    return _nodepath.resolve(process.cwd(), '..', 'stock-training', 'data', 'stock_profile.csv');
}
function parseStockProfileCsv(filePath) {
    if (!_nodefs.existsSync(filePath)) return [];
    const raw = _nodefs.readFileSync(filePath, 'utf-8');
    const lines = raw.split(/\r?\n/).filter((l)=>l.length > 0);
    if (lines.length < 2) return [];
    const out = [];
    for(let i = 1; i < lines.length; i++){
        const parts = lines[i].split(',');
        const symbol = (parts[0] ?? '').trim().toUpperCase();
        if (!symbol) continue;
        const soRaw = (parts[1] ?? '').trim();
        const mcRaw = (parts[2] ?? '').trim();
        const soNum = soRaw === '' ? NaN : parseFloat(soRaw);
        const mcNum = mcRaw === '' ? NaN : parseFloat(mcRaw);
        out.push({
            symbol,
            sharesOutstanding: !isNaN(soNum) && soNum > 0 ? soNum : null,
            marketCap: !isNaN(mcNum) && mcNum > 0 ? mcNum : null
        });
    }
    return out;
}
let FundamentalCacheService = class FundamentalCacheService {
    async onModuleInit() {
        await this.mysqlRepo.ensureStockProfileTable();
        const count = await this.mysqlRepo.countStockProfileRows();
        const csvPath = resolveStockProfileCsvPath();
        const csvRows = parseStockProfileCsv(csvPath);
        if (count === 0 && csvRows.length > 0) {
            await this.mysqlRepo.bulkReplaceStockProfiles(csvRows);
            this.logger.log(`Seeded stock_profile from CSV (${csvRows.length} rows) → ${csvPath}`);
        } else if (count === 0 && csvRows.length === 0) {
            this.logger.warn(`stock_profile empty and no CSV at ${csvPath}; fundamentals will use Finnhub only`);
        }
        let loaded = await this.mysqlRepo.loadAllStockProfiles();
        if (loaded.size === 0 && csvRows.length > 0) {
            for (const r of csvRows){
                loaded.set(r.symbol, {
                    sharesOutstanding: r.sharesOutstanding,
                    marketCap: r.marketCap
                });
            }
            this.logger.log(`Fundamentals: loaded ${csvRows.length} symbols from CSV (MySQL empty or unavailable)`);
        }
        for (const [sym, v] of loaded){
            this.cache.set(sym, v);
        }
        this.logger.log(`Fundamentals cache ready: ${this.cache.size} symbols`);
    }
    ensureFinnhubKeyLoaded() {
        if (this.envLoaded || process.env.FINNHUB_API_KEY) return;
        this.envLoaded = true;
        try {
            const dotenv = require('dotenv');
            const stockTrainingEnv = _nodepath.resolve(process.cwd(), '..', 'stock-training', '.env');
            dotenv.config({
                path: stockTrainingEnv
            });
        } catch  {
        /* ignore */ }
    }
    async fetchFromFinnhub(ticker, token) {
        const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${token}`;
        const res = await _axios.default.get(url, {
            timeout: 8000
        });
        const profile = res.data ?? {};
        const so = profile.shareOutstanding ?? profile.share_outstanding;
        const soNum = typeof so === 'number' ? so : typeof so === 'string' ? parseFloat(so) : NaN;
        const sharesOutstanding = !isNaN(soNum) && soNum > 0 ? soNum * 1_000_000 : null;
        const mc = profile.marketCapitalization ?? profile.market_capitalization;
        const mcNum = typeof mc === 'number' ? mc : typeof mc === 'string' ? parseFloat(mc) : NaN;
        const marketCap = !isNaN(mcNum) && mcNum > 0 ? mcNum : null;
        return {
            sharesOutstanding,
            marketCap
        };
    }
    /**
   * Get fundamentals for symbol. Memory first (seeded from MySQL / CSV), then Finnhub on miss.
   * Persists Finnhub hits to MySQL when at least one field is non-null.
   */ async getFundamentals(symbol) {
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
        } catch (err) {
            if (_axios.default.isAxiosError(err) && err.response?.status === 429) throw err;
            this.cache.set(key, EMPTY);
            return EMPTY;
        }
    }
    constructor(mysqlRepo){
        this.mysqlRepo = mysqlRepo;
        this.logger = new _common.Logger(FundamentalCacheService.name);
        this.cache = new Map();
        this.envLoaded = false;
    }
};
FundamentalCacheService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _mysqltrainingrepository.MysqlTrainingRepository === "undefined" ? Object : _mysqltrainingrepository.MysqlTrainingRepository
    ])
], FundamentalCacheService);

//# sourceMappingURL=fundamental-cache.service.js.map