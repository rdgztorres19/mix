"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "NewsCacheService", {
    enumerable: true,
    get: function() {
        return NewsCacheService;
    }
});
const _common = require("@nestjs/common");
const _ioredis = /*#__PURE__*/ _interop_require_default(require("ioredis"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
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
let NewsCacheService = class NewsCacheService {
    onModuleInit() {
        if (this.ttlSec === 0) {
            this.logger.warn('NEWS_CACHE_TTL_SEC=0 — news cache disabled');
            return;
        }
        const url = process.env.REDIS_URL || 'redis://localhost:6379';
        try {
            this.redis = new _ioredis.default(url, {
                lazyConnect: true,
                connectTimeout: 3000,
                maxRetriesPerRequest: 1,
                enableOfflineQueue: false
            });
            this.redis.on('connect', ()=>this.logger.log(`Redis connected → ${url}`));
            this.redis.on('error', (err)=>this.logger.warn(`Redis error: ${err.message}`));
            this.redis.connect().catch((err)=>this.logger.warn(`Redis initial connect failed: ${err.message} — cache disabled for this session`));
        } catch (err) {
            this.logger.warn(`Redis init failed: ${err.message} — cache disabled`);
            this.redis = null;
        }
    }
    onModuleDestroy() {
        this.redis?.disconnect();
    }
    key(ticker) {
        return `${this.keyPrefix}${ticker.toUpperCase()}`;
    }
    async get(ticker) {
        if (!this.redis || this.ttlSec === 0) return null;
        try {
            const raw = await this.redis.get(this.key(ticker));
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const ageMs = Date.now() - parsed.cached_at;
            this.logger.log(`[Cache HIT] ${ticker} catalyst=${parsed.strength} age=${Math.round(ageMs / 1000)}s`);
            return parsed;
        } catch (err) {
            this.logger.warn(`Cache get error for ${ticker}: ${err.message}`);
            return null;
        }
    }
    async set(ticker, catalyst) {
        if (!this.redis || this.ttlSec === 0) return;
        try {
            const value = {
                ...catalyst,
                cached_at: Date.now()
            };
            await this.redis.set(this.key(ticker), JSON.stringify(value), 'EX', this.ttlSec);
            this.logger.log(`[Cache SET] ${ticker} catalyst=${catalyst.strength} TTL=${this.ttlSec}s`);
        } catch (err) {
            this.logger.warn(`Cache set error for ${ticker}: ${err.message}`);
        }
    }
    /** Force-invalidate a ticker's cache (e.g. after a breaking news event). */ async invalidate(ticker) {
        if (!this.redis) return;
        try {
            await this.redis.del(this.key(ticker));
            this.logger.log(`[Cache INVALIDATE] ${ticker}`);
        } catch (err) {
            this.logger.warn(`Cache invalidate error for ${ticker}: ${err.message}`);
        }
    }
    /** Returns cache TTL remaining in seconds (-1 = no TTL, -2 = key missing). */ async ttlRemaining(ticker) {
        if (!this.redis) return -2;
        try {
            return await this.redis.ttl(this.key(ticker));
        } catch  {
            return -2;
        }
    }
    constructor(){
        this.logger = new _common.Logger(NewsCacheService.name);
        this.redis = null;
        this.keyPrefix = 'news_catalyst:';
        this.ttlSec = parseInt(process.env.NEWS_CACHE_TTL_SEC ?? '300', 10);
    }
};
NewsCacheService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [])
], NewsCacheService);

//# sourceMappingURL=news-cache.service.js.map