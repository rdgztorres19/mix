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
    get AbcdStrategy () {
        return _abcdstrategy.AbcdStrategy;
    },
    get BullFlagStrategy () {
        return _bullflagstrategy.BullFlagStrategy;
    },
    get FallenAngelStrategy () {
        return _fallenangelstrategy.FallenAngelStrategy;
    },
    get GeneralStrategy () {
        return _generalstrategy.GeneralStrategy;
    },
    get OrbStrategy () {
        return _orbstrategy.OrbStrategy;
    },
    get StrategyFactory () {
        return _strategyfactory.StrategyFactory;
    },
    get VwapFalseBreakoutStrategy () {
        return _vwapfalsebreakoutstrategy.VwapFalseBreakoutStrategy;
    },
    get VwapMaTrendStrategy () {
        return _vwapmatrendstrategy.VwapMaTrendStrategy;
    },
    get VwapReversalStrategy () {
        return _vwapreversalstrategy.VwapReversalStrategy;
    }
});
const _bullflagstrategy = require("./bull-flag.strategy");
const _fallenangelstrategy = require("./fallen-angel.strategy");
const _abcdstrategy = require("./abcd.strategy");
const _orbstrategy = require("./orb.strategy");
const _vwapreversalstrategy = require("./vwap-reversal.strategy");
const _vwapfalsebreakoutstrategy = require("./vwap-false-breakout.strategy");
const _vwapmatrendstrategy = require("./vwap-ma-trend.strategy");
const _generalstrategy = require("./general.strategy");
const _strategyfactory = require("./strategy.factory");

//# sourceMappingURL=index.js.map