"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ScreenerModule", {
    enumerable: true,
    get: function() {
        return ScreenerModule;
    }
});
const _common = require("@nestjs/common");
const _screenerservice = require("./screener.service");
const _screenercontroller = require("./screener.controller");
const _alpacabatchservice = require("./batch/alpaca-batch.service");
const _rankingservice = require("./ranking/ranking.service");
const _assetsservice = require("./assets/assets.service");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
let ScreenerModule = class ScreenerModule {
};
ScreenerModule = _ts_decorate([
    (0, _common.Module)({
        providers: [
            _screenerservice.ScreenerService,
            _alpacabatchservice.AlpacaBatchService,
            _rankingservice.RankingService,
            _assetsservice.AssetsService
        ],
        controllers: [
            _screenercontroller.ScreenerController
        ],
        exports: [
            _screenerservice.ScreenerService,
            _rankingservice.RankingService
        ]
    })
], ScreenerModule);

//# sourceMappingURL=screener.module.js.map