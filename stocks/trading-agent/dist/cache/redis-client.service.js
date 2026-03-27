"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "RedisClientService", {
    enumerable: true,
    get: function() {
        return RedisClientService;
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
let RedisClientService = class RedisClientService {
    onModuleInit() {
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
            this.redis.connect().catch((err)=>{
                this.logger.warn(`Redis initial connect failed: ${err.message}`);
            });
        } catch (err) {
            this.logger.warn(`Redis init failed: ${err.message}`);
            this.redis = null;
        }
    }
    onModuleDestroy() {
        this.redis?.disconnect();
    }
    getClient() {
        return this.redis;
    }
    isReady() {
        return this.redis != null;
    }
    constructor(){
        this.logger = new _common.Logger(RedisClientService.name);
        this.redis = null;
    }
};
RedisClientService = _ts_decorate([
    (0, _common.Injectable)()
], RedisClientService);

//# sourceMappingURL=redis-client.service.js.map