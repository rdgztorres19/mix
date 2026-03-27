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
const _redisclientservice = require("./redis-client.service");
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
    key(ticker) {
        return `${this.keyPrefix}${ticker.toUpperCase()}`;
    }
    async get(ticker) {
        const redis = this.redisClient.getClient();
        if (!redis || this.ttlSec === 0) return null;
        try {
            const raw = await redis.get(this.key(ticker));
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
        const redis = this.redisClient.getClient();
        if (!redis || this.ttlSec === 0) return;
        try {
            const value = {
                ...catalyst,
                cached_at: Date.now()
            };
            await redis.set(this.key(ticker), JSON.stringify(value), 'EX', this.ttlSec);
            this.logger.log(`[Cache SET] ${ticker} catalyst=${catalyst.strength} TTL=${this.ttlSec}s`);
        } catch (err) {
            this.logger.warn(`Cache set error for ${ticker}: ${err.message}`);
        }
    }
    async invalidate(ticker) {
        const redis = this.redisClient.getClient();
        if (!redis) return;
        try {
            await redis.del(this.key(ticker));
            this.logger.log(`[Cache INVALIDATE] ${ticker}`);
        } catch (err) {
            this.logger.warn(`Cache invalidate error for ${ticker}: ${err.message}`);
        }
    }
    async ttlRemaining(ticker) {
        const redis = this.redisClient.getClient();
        if (!redis) return -2;
        try {
            return await redis.ttl(this.key(ticker));
        } catch  {
            return -2;
        }
    }
    constructor(redisClient){
        this.redisClient = redisClient;
        this.logger = new _common.Logger(NewsCacheService.name);
        this.keyPrefix = 'news_catalyst:';
        this.ttlSec = parseInt(process.env.NEWS_CACHE_TTL_SEC ?? '300', 10);
        if (this.ttlSec === 0) {
            this.logger.warn('NEWS_CACHE_TTL_SEC=0 — news cache disabled');
        }
    }
};
NewsCacheService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _redisclientservice.RedisClientService === "undefined" ? Object : _redisclientservice.RedisClientService
    ])
], NewsCacheService);

//# sourceMappingURL=news-cache.service.js.map