"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "TraderModule", {
    enumerable: true,
    get: function() {
        return TraderModule;
    }
});
const _common = require("@nestjs/common");
const _scannermodule = require("../scanner/scanner.module");
const _predictormodule = require("../predictor/predictor.module");
const _cachemodule = require("../cache/cache.module");
const _alpacatraderservice = require("./alpaca-trader.service");
const _positiontrackerservice = require("./position-tracker.service");
const _autotraderservice = require("./auto-trader.service");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
let TraderModule = class TraderModule {
};
TraderModule = _ts_decorate([
    (0, _common.Module)({
        imports: [
            _scannermodule.ScannerModule,
            _predictormodule.PredictorModule,
            _cachemodule.CacheModule
        ],
        providers: [
            _alpacatraderservice.AlpacaTraderService,
            _positiontrackerservice.PositionTrackerService,
            _autotraderservice.AutoTraderService
        ],
        exports: [
            _autotraderservice.AutoTraderService,
            _positiontrackerservice.PositionTrackerService
        ]
    })
], TraderModule);

//# sourceMappingURL=trader.module.js.map