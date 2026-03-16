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
    get TopGainerSourceEnum () {
        return TopGainerSourceEnum;
    },
    get TopGainersSourceService () {
        return TopGainersSourceService;
    },
    get getTopGainerSourceFromEnv () {
        return getTopGainerSourceFromEnv;
    }
});
const _common = require("@nestjs/common");
const _config = require("@nestjs/config");
const _axios = /*#__PURE__*/ _interop_require_default(require("axios"));
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
var TopGainerSourceEnum = /*#__PURE__*/ function(TopGainerSourceEnum) {
    TopGainerSourceEnum["HPG"] = "HPG";
    TopGainerSourceEnum["ALPACA"] = "ALPACA";
    return TopGainerSourceEnum;
}({});
function getTopGainerSourceFromEnv() {
    const raw = (process.env.TOP_GAINERS_SOURCE ?? 'alpaca').toLowerCase();
    return raw === 'hpg' ? 'hpg' : 'alpaca_screener';
}
const HPG_URL = 'https://hpg-api.hpg-charts.workers.dev/get-top-gainers-all';
const ALPACA_SCREENER_URL = 'https://data.alpaca.markets/v1beta1/screener/stocks/movers';
let TopGainersSourceService = class TopGainersSourceService {
    /**
   * Fetch top gainer symbols from HPG API (get-top-gainers-all).
   */ async fetchFromHpg() {
        try {
            const res = await _axios.default.get(HPG_URL, {
                timeout: 10000
            });
            const gainers = res.data?.gainers;
            if (!Array.isArray(gainers)) {
                this.logger.warn('HPG API: invalid response (no gainers array)');
                return [];
            }
            const symbols = gainers.map((g)=>g?.symbol?.toUpperCase()).filter((s)=>s && s.length > 0);
            this.logger.log(`HPG: fetched ${symbols.length} top gainers`);
            return symbols;
        } catch (err) {
            this.logger.warn(`HPG fetch failed: ${err.message}`);
            return [];
        }
    }
    /**
   * Fetch top gainer symbols from Alpaca screener.
   * Requires ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY (or ALPACA_KEY_ID / ALPACA_SECRET_KEY).
   */ async fetchFromAlpacaScreener() {
        const keyId = process.env.ALPACA_PAPER_KEY_ID;
        const secretKey = process.env.ALPACA_PAPER_SECRET_KEY;
        if (!keyId || !secretKey) {
            this.logger.warn('Alpaca screener: missing API keys (ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY)');
            return [];
        }
        try {
            const res = await _axios.default.get(ALPACA_SCREENER_URL, {
                timeout: 10000,
                headers: {
                    'APCA-API-KEY-ID': keyId,
                    'APCA-API-SECRET-KEY': secretKey
                }
            });
            const gainers = res.data?.gainers;
            if (!Array.isArray(gainers)) {
                this.logger.warn('Alpaca screener: invalid response (no gainers array)');
                return [];
            }
            const symbols = gainers.map((g)=>g?.symbol?.toUpperCase()).filter((s)=>s && s.length > 0);
            this.logger.log(`Alpaca screener: fetched ${symbols.length} top gainers`);
            return symbols;
        } catch (err) {
            this.logger.warn(`Alpaca screener fetch failed: ${err.message}`);
            return [];
        }
    }
    /**
   * Fetch symbols from the given source.
   */ async fetchSymbols(source) {
        if (source === 'hpg') return this.fetchFromHpg();
        return this.fetchFromAlpacaScreener();
    }
    constructor(configService){
        this.configService = configService;
        this.logger = new _common.Logger(TopGainersSourceService.name);
    }
};
TopGainersSourceService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _config.ConfigService === "undefined" ? Object : _config.ConfigService
    ])
], TopGainersSourceService);

//# sourceMappingURL=top-gainers-source.service.js.map