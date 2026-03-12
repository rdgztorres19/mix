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
        return _atrcalculator.AtrCalculator;
    },
    get EmaCalculator () {
        return _emacalculator.EmaCalculator;
    },
    get VwapCalculator () {
        return _vwapcalculator.VwapCalculator;
    }
});
const _vwapcalculator = require("./vwap.calculator");
const _emacalculator = require("./ema.calculator");
const _atrcalculator = require("./atr.calculator");

//# sourceMappingURL=index.js.map