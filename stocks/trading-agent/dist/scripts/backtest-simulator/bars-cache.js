"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get connectRedis () {
        return connectRedis;
    },
    get getCachedBars () {
        return getCachedBars;
    },
    get setCachedBars () {
        return setCachedBars;
    }
});
const _ioredis = /*#__PURE__*/ _interop_require_default(require("ioredis"));
const _zlib = /*#__PURE__*/ _interop_require_wildcard(require("zlib"));
const _util = require("util");
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
const gzip = (0, _util.promisify)(_zlib.gzip);
const gunzip = (0, _util.promisify)(_zlib.gunzip);
const TTL_SECONDS = 86_400; // 1 day
function redisKey(date) {
    return `backtest:1m:bars:${date}`;
}
async function connectRedis() {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    const redis = new _ioredis.default(url, {
        lazyConnect: true,
        connectTimeout: 5000,
        maxRetriesPerRequest: 1
    });
    await redis.connect();
    return redis;
}
async function getCachedBars(redis, date) {
    const buf = await redis.getBuffer(redisKey(date));
    if (!buf) return null;
    const json = (await gunzip(buf)).toString('utf-8');
    const obj = JSON.parse(json);
    const map = new Map();
    for (const [sym, bars] of Object.entries(obj)){
        map.set(sym, bars);
    }
    return map;
}
async function setCachedBars(redis, date, bars) {
    const obj = {};
    bars.forEach((barArr, sym)=>{
        obj[sym] = barArr;
    });
    const json = JSON.stringify(obj);
    const compressed = await gzip(Buffer.from(json, 'utf-8'));
    await redis.setex(redisKey(date), TTL_SECONDS, compressed);
}

//# sourceMappingURL=bars-cache.js.map