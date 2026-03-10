"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "StrategyFactory", {
    enumerable: true,
    get: function() {
        return StrategyFactory;
    }
});
const _bullflagstrategy = require("./bull-flag.strategy");
const _fallenangelstrategy = require("./fallen-angel.strategy");
const _abcdstrategy = require("./abcd.strategy");
const _orbstrategy = require("./orb.strategy");
const _vwapreversalstrategy = require("./vwap-reversal.strategy");
const _vwapfalsebreakoutstrategy = require("./vwap-false-breakout.strategy");
const _vwaplatemorningstrategy = require("./vwap-late-morning.strategy");
const _vwapmatrendstrategy = require("./vwap-ma-trend.strategy");
const _generalstrategy = require("./general.strategy");
/**
 * Order matters: more specific strategies first, GENERAL last.
 * BullFlag & FallenAngel are THE_OPEN-specific patterns;
 * ABCD is THE_OPEN + LATE_MORNING;
 * ORB is THE_OPEN;
 * VWAP strategies cover later sessions;
 * GENERAL is the fallback.
 */ const STRATEGIES = [
    new _bullflagstrategy.BullFlagStrategy(),
    new _fallenangelstrategy.FallenAngelStrategy(),
    new _abcdstrategy.AbcdStrategy(),
    new _orbstrategy.OrbStrategy(),
    new _vwapreversalstrategy.VwapReversalStrategy(),
    new _vwapfalsebreakoutstrategy.VwapFalseBreakoutStrategy(),
    new _vwaplatemorningstrategy.VwapLateMorningStrategy(),
    new _vwapmatrendstrategy.VwapMaTrendStrategy(),
    new _generalstrategy.GeneralStrategy()
];
let StrategyFactory = class StrategyFactory {
    getStrategy(ctx) {
        for (const s of STRATEGIES){
            if (s.matches(ctx)) return s;
        }
        return new _generalstrategy.GeneralStrategy();
    }
};

//# sourceMappingURL=strategy.factory.js.map