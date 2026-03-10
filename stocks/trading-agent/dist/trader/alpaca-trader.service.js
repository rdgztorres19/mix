/**
 * AlpacaTraderService: thin wrapper around Alpaca Paper Trading REST API v2.
 * Uses raw axios — no SDK dependency needed.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AlpacaTraderService", {
    enumerable: true,
    get: function() {
        return AlpacaTraderService;
    }
});
const _common = require("@nestjs/common");
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
let AlpacaTraderService = class AlpacaTraderService {
    isEnabled() {
        return this.enabled;
    }
    async getAccount() {
        const { data } = await this.client.get('/account');
        return {
            equity: parseFloat(data.equity),
            buying_power: parseFloat(data.buying_power),
            cash: parseFloat(data.cash)
        };
    }
    /**
   * Buy a symbol with a dollar amount (market order, fractional qty).
   */ async buyMarket(symbol, dollarAmount) {
        this.logger.log(`BUY ${symbol} ~$${dollarAmount.toFixed(2)} (market)`);
        const { data } = await this.client.post('/orders', {
            symbol: symbol.toUpperCase(),
            notional: dollarAmount.toFixed(2),
            side: 'buy',
            type: 'market',
            time_in_force: 'day'
        });
        return data;
    }
    /**
   * Sell a position by quantity (market order).
   */ async sellMarket(symbol, qty) {
        this.logger.log(`SELL ${symbol} qty=${qty} (market)`);
        const { data } = await this.client.post('/orders', {
            symbol: symbol.toUpperCase(),
            qty: String(qty),
            side: 'sell',
            type: 'market',
            time_in_force: 'day'
        });
        return data;
    }
    /**
   * Get current position for a symbol (null if no position).
   */ async getPosition(symbol) {
        try {
            const { data } = await this.client.get(`/positions/${symbol.toUpperCase()}`);
            return {
                symbol: data.symbol,
                qty: parseFloat(data.qty),
                avg_entry_price: parseFloat(data.avg_entry_price),
                current_price: parseFloat(data.current_price),
                market_value: parseFloat(data.market_value),
                unrealized_pl: parseFloat(data.unrealized_pl)
            };
        } catch (err) {
            if (err?.response?.status === 404) return null;
            throw err;
        }
    }
    /**
   * Get all open positions.
   */ async getAllPositions() {
        const { data } = await this.client.get('/positions');
        return data.map((p)=>({
                symbol: p.symbol,
                qty: parseFloat(p.qty),
                avg_entry_price: parseFloat(p.avg_entry_price),
                current_price: parseFloat(p.current_price),
                market_value: parseFloat(p.market_value),
                unrealized_pl: parseFloat(p.unrealized_pl)
            }));
    }
    constructor(){
        this.logger = new _common.Logger(AlpacaTraderService.name);
        this.enabled = false;
        const baseURL = process.env.ALPACA_PAPER_BASE_URL || 'https://paper-api.alpaca.markets/v2';
        const keyId = process.env.ALPACA_PAPER_KEY_ID || '';
        const secretKey = process.env.ALPACA_PAPER_SECRET_KEY || '';
        this.enabled = !!(keyId && secretKey);
        this.client = _axios.default.create({
            baseURL,
            headers: {
                'APCA-API-KEY-ID': keyId,
                'APCA-API-SECRET-KEY': secretKey,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });
        if (this.enabled) {
            this.logger.log('AlpacaTraderService configured (paper trading)');
        } else {
            this.logger.warn('AlpacaTraderService: missing ALPACA_PAPER keys — trading disabled');
        }
    }
};
AlpacaTraderService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [])
], AlpacaTraderService);

//# sourceMappingURL=alpaca-trader.service.js.map