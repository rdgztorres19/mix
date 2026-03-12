"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AtrCalculator = exports.EmaCalculator = exports.VwapCalculator = void 0;
exports.applyTradingRules = applyTradingRules;
const trading_rules_engine_1 = require("./trading-rules.engine");
var indicators_1 = require("./indicators");
Object.defineProperty(exports, "VwapCalculator", { enumerable: true, get: function () { return indicators_1.VwapCalculator; } });
Object.defineProperty(exports, "EmaCalculator", { enumerable: true, get: function () { return indicators_1.EmaCalculator; } });
Object.defineProperty(exports, "AtrCalculator", { enumerable: true, get: function () { return indicators_1.AtrCalculator; } });
const engine = new trading_rules_engine_1.TradingRulesEngine();
function applyTradingRules(params) {
    let candles = [];
    try {
        if (params.last_candles_json) {
            candles = JSON.parse(params.last_candles_json);
        }
    }
    catch {
        candles = [];
    }
    const ctx = {
        ticker: params.ticker,
        price: params.price,
        vwap: params.vwap,
        ema9: params.ema9,
        ema20: params.ema20,
        relative_volume: params.relative_volume,
        change_pct: params.change_pct,
        atr: params.atr,
        session: params.session,
        pre_market_high: params.pre_market_high,
        account_size: params.account_size,
        candles,
    };
    return engine.evaluate(ctx);
}
//# sourceMappingURL=index.js.map