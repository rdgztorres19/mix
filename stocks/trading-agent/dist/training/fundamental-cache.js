/**
 * Fundamentals cache — shares_outstanding, market_cap.
 * Duplicated from stock-training/src/data/fundamental-fetcher.ts - keep in sync.
 * Cache key: symbol (fundamentals don't change intraday).
 * Used by sync-symbol-date and sync-date to populate rows when no candle has them.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getFundamentals", {
    enumerable: true,
    get: function() {
        return getFundamentals;
    }
});
const _path = /*#__PURE__*/ _interop_require_wildcard(require("path"));
const _axios = /*#__PURE__*/ _interop_require_default(require("axios"));
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
const cache = new Map();
let envLoaded = false;
const EMPTY = {
    sharesOutstanding: null,
    marketCap: null
};
function ensureFinnhubKeyLoaded() {
    if (envLoaded || process.env.FINNHUB_API_KEY) return;
    envLoaded = true;
    try {
        const dotenv = require('dotenv');
        const stockTrainingEnv = _path.resolve(process.cwd(), '..', 'stock-training', '.env');
        dotenv.config({
            path: stockTrainingEnv
        });
    } catch  {
    /* ignore */ }
}
async function fetchFromFinnhub(ticker, token) {
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
async function getFundamentals(symbol) {
    const key = symbol.toUpperCase();
    const cached = cache.get(key);
    if (cached) return cached;
    ensureFinnhubKeyLoaded();
    const token = process.env.FINNHUB_API_KEY?.trim();
    if (!token) {
        cache.set(key, EMPTY);
        return EMPTY;
    }
    try {
        const result = await fetchFromFinnhub(key, token);
        cache.set(key, result);
        return result;
    } catch (err) {
        if (_axios.default.isAxiosError(err) && err.response?.status === 429) throw err;
        cache.set(key, EMPTY);
        return EMPTY;
    }
}

//# sourceMappingURL=fundamental-cache.js.map