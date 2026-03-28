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
const _cachemodule = require("../../cache/cache.module");
const _screenerservice = require("./screener.service");
const _screenercontroller = require("./screener.controller");
const _rankingservice = require("./ranking/ranking.service");
const _assetsservice = require("./assets/assets.service");
const _screenerrepository = require("./persistence/screener.repository");
const _alpacascreenerclient = require("./alpaca/alpaca-screener.client");
const _activesymbolsservice = require("./active/active-symbols.service");
const _screenercron = require("./schedule/screener.cron");
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
        imports: [
            _cachemodule.CacheModule
        ],
        providers: [
            _screenerrepository.ScreenerRepository,
            _alpacascreenerclient.AlpacaScreenerClient,
            _assetsservice.AssetsService,
            _activesymbolsservice.ActiveSymbolsService,
            _rankingservice.RankingService,
            _screenerservice.ScreenerService,
            _screenercron.ScreenerCron
        ],
        controllers: [
            _screenercontroller.ScreenerController
        ],
        exports: [
            _screenerservice.ScreenerService,
            _rankingservice.RankingService,
            _screenerrepository.ScreenerRepository
        ]
    })
], ScreenerModule);

//# sourceMappingURL=screener.module.js.map