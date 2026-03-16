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
    get AtrCalculator () {
        return _indicators.AtrCalculator;
    },
    get EmaCalculator () {
        return _indicators.EmaCalculator;
    },
    get VwapCalculator () {
        return _indicators.VwapCalculator;
    },
    get applyTradingRules () {
        return applyTradingRules;
    }
});
const _tradingrulesengine = require("./trading-rules.engine");
const _indicators = require("./indicators");
const engine = new _tradingrulesengine.TradingRulesEngine();
function applyTradingRules(params) {
    let candles = [];
    try {
        if (params.last_candles_json) {
            candles = JSON.parse(params.last_candles_json);
        }
    } catch  {
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
        candles
    };
    return engine.evaluate(ctx);
}

//# sourceMappingURL=index.js.map