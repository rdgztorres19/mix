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
var TopGainersSourceService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TopGainersSourceService = exports.TopGainerSourceEnum = void 0;
exports.getTopGainerSourceFromEnv = getTopGainerSourceFromEnv;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const axios_1 = __importDefault(require("axios"));
var TopGainerSourceEnum;
(function (TopGainerSourceEnum) {
    TopGainerSourceEnum["HPG"] = "HPG";
    TopGainerSourceEnum["ALPACA"] = "ALPACA";
})(TopGainerSourceEnum || (exports.TopGainerSourceEnum = TopGainerSourceEnum = {}));
function getTopGainerSourceFromEnv() {
    const raw = (process.env.TOP_GAINERS_SOURCE ?? 'alpaca').toLowerCase();
    return raw === 'hpg' ? 'hpg' : 'alpaca_screener';
}
const HPG_URL = 'https://hpg-api.hpg-charts.workers.dev/get-top-gainers-all';
const ALPACA_SCREENER_URL = 'https://data.alpaca.markets/v1beta1/screener/stocks/movers';
let TopGainersSourceService = TopGainersSourceService_1 = class TopGainersSourceService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(TopGainersSourceService_1.name);
    }
    async fetchFromHpg() {
        try {
            const res = await axios_1.default.get(HPG_URL, { timeout: 10000 });
            const gainers = res.data?.gainers;
            if (!Array.isArray(gainers)) {
                this.logger.warn('HPG API: invalid response (no gainers array)');
                return [];
            }
            const symbols = gainers
                .map((g) => g?.symbol?.toUpperCase())
                .filter((s) => s && s.length > 0);
            this.logger.log(`HPG: fetched ${symbols.length} top gainers`);
            return symbols;
        }
        catch (err) {
            this.logger.warn(`HPG fetch failed: ${err.message}`);
            return [];
        }
    }
    async fetchFromAlpacaScreener() {
        const keyId = process.env.ALPACA_PAPER_KEY_ID;
        const secretKey = process.env.ALPACA_PAPER_SECRET_KEY;
        if (!keyId || !secretKey) {
            this.logger.warn('Alpaca screener: missing API keys (ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY)');
            return [];
        }
        try {
            const res = await axios_1.default.get(ALPACA_SCREENER_URL, {
                timeout: 10000,
                headers: {
                    'APCA-API-KEY-ID': keyId,
                    'APCA-API-SECRET-KEY': secretKey,
                },
            });
            const gainers = res.data?.gainers;
            if (!Array.isArray(gainers)) {
                this.logger.warn('Alpaca screener: invalid response (no gainers array)');
                return [];
            }
            const symbols = gainers
                .map((g) => g?.symbol?.toUpperCase())
                .filter((s) => s && s.length > 0);
            this.logger.log(`Alpaca screener: fetched ${symbols.length} top gainers`);
            return symbols;
        }
        catch (err) {
            this.logger.warn(`Alpaca screener fetch failed: ${err.message}`);
            return [];
        }
    }
    async fetchSymbols(source) {
        if (source === 'hpg')
            return this.fetchFromHpg();
        return this.fetchFromAlpacaScreener();
    }
};
exports.TopGainersSourceService = TopGainersSourceService;
exports.TopGainersSourceService = TopGainersSourceService = TopGainersSourceService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], TopGainersSourceService);
//# sourceMappingURL=top-gainers-source.service.js.map