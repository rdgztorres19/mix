"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var NewsCacheService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NewsCacheService = void 0;
const common_1 = require("@nestjs/common");
const ioredis_1 = __importDefault(require("ioredis"));
let NewsCacheService = NewsCacheService_1 = class NewsCacheService {
    constructor() {
        this.logger = new common_1.Logger(NewsCacheService_1.name);
        this.redis = null;
        this.keyPrefix = 'news_catalyst:';
        this.ttlSec = parseInt(process.env.NEWS_CACHE_TTL_SEC ?? '300', 10);
    }
    onModuleInit() {
        if (this.ttlSec === 0) {
            this.logger.warn('NEWS_CACHE_TTL_SEC=0 — news cache disabled');
            return;
        }
        const url = process.env.REDIS_URL || 'redis://localhost:6379';
        try {
            this.redis = new ioredis_1.default(url, {
                lazyConnect: true,
                connectTimeout: 3000,
                maxRetriesPerRequest: 1,
                enableOfflineQueue: false,
            });
            this.redis.on('connect', () => this.logger.log(`Redis connected → ${url}`));
            this.redis.on('error', (err) => this.logger.warn(`Redis error: ${err.message}`));
            this.redis.connect().catch((err) => this.logger.warn(`Redis initial connect failed: ${err.message} — cache disabled for this session`));
        }
        catch (err) {
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
        if (!this.redis || this.ttlSec === 0)
            return null;
        try {
            const raw = await this.redis.get(this.key(ticker));
            if (!raw)
                return null;
            const parsed = JSON.parse(raw);
            const ageMs = Date.now() - parsed.cached_at;
            this.logger.log(`[Cache HIT] ${ticker} catalyst=${parsed.strength} age=${Math.round(ageMs / 1000)}s`);
            return parsed;
        }
        catch (err) {
            this.logger.warn(`Cache get error for ${ticker}: ${err.message}`);
            return null;
        }
    }
    async set(ticker, catalyst) {
        if (!this.redis || this.ttlSec === 0)
            return;
        try {
            const value = { ...catalyst, cached_at: Date.now() };
            await this.redis.set(this.key(ticker), JSON.stringify(value), 'EX', this.ttlSec);
            this.logger.log(`[Cache SET] ${ticker} catalyst=${catalyst.strength} TTL=${this.ttlSec}s`);
        }
        catch (err) {
            this.logger.warn(`Cache set error for ${ticker}: ${err.message}`);
        }
    }
    async invalidate(ticker) {
        if (!this.redis)
            return;
        try {
            await this.redis.del(this.key(ticker));
            this.logger.log(`[Cache INVALIDATE] ${ticker}`);
        }
        catch (err) {
            this.logger.warn(`Cache invalidate error for ${ticker}: ${err.message}`);
        }
    }
    async ttlRemaining(ticker) {
        if (!this.redis)
            return -2;
        try {
            return await this.redis.ttl(this.key(ticker));
        }
        catch {
            return -2;
        }
    }
};
exports.NewsCacheService = NewsCacheService;
exports.NewsCacheService = NewsCacheService = NewsCacheService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], NewsCacheService);
//# sourceMappingURL=news-cache.service.js.map