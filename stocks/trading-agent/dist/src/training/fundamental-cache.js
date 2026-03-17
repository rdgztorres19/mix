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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFundamentals = getFundamentals;
const path = __importStar(require("path"));
const axios_1 = __importDefault(require("axios"));
const cache = new Map();
let envLoaded = false;
const EMPTY = { sharesOutstanding: null, marketCap: null };
function ensureFinnhubKeyLoaded() {
    if (envLoaded || process.env.FINNHUB_API_KEY)
        return;
    envLoaded = true;
    try {
        const dotenv = require('dotenv');
        const stockTrainingEnv = path.resolve(process.cwd(), '..', 'stock-training', '.env');
        dotenv.config({ path: stockTrainingEnv });
    }
    catch {
    }
}
async function fetchFromFinnhub(ticker, token) {
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
async function getFundamentals(symbol) {
    const key = symbol.toUpperCase();
    const cached = cache.get(key);
    if (cached)
        return cached;
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
    }
    catch (err) {
        if (axios_1.default.isAxiosError(err) && err.response?.status === 429)
            throw err;
        cache.set(key, EMPTY);
        return EMPTY;
    }
}
//# sourceMappingURL=fundamental-cache.js.map