"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StrategyFactory = void 0;
const bull_flag_strategy_1 = require("./bull-flag.strategy");
const fallen_angel_strategy_1 = require("./fallen-angel.strategy");
const abcd_strategy_1 = require("./abcd.strategy");
const orb_strategy_1 = require("./orb.strategy");
const vwap_reversal_strategy_1 = require("./vwap-reversal.strategy");
const vwap_false_breakout_strategy_1 = require("./vwap-false-breakout.strategy");
const vwap_late_morning_strategy_1 = require("./vwap-late-morning.strategy");
const vwap_ma_trend_strategy_1 = require("./vwap-ma-trend.strategy");
const general_strategy_1 = require("./general.strategy");
const STRATEGIES = [
    new bull_flag_strategy_1.BullFlagStrategy(),
    new fallen_angel_strategy_1.FallenAngelStrategy(),
    new abcd_strategy_1.AbcdStrategy(),
    new orb_strategy_1.OrbStrategy(),
    new vwap_reversal_strategy_1.VwapReversalStrategy(),
    new vwap_false_breakout_strategy_1.VwapFalseBreakoutStrategy(),
    new vwap_late_morning_strategy_1.VwapLateMorningStrategy(),
    new vwap_ma_trend_strategy_1.VwapMaTrendStrategy(),
    new general_strategy_1.GeneralStrategy(),
];
class StrategyFactory {
    getStrategy(ctx) {
        for (const s of STRATEGIES) {
            if (s.matches(ctx))
                return s;
        }
        return new general_strategy_1.GeneralStrategy();
    }
}
exports.StrategyFactory = StrategyFactory;
//# sourceMappingURL=strategy.factory.js.map