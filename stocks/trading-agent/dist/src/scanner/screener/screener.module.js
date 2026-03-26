"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScreenerModule = void 0;
const common_1 = require("@nestjs/common");
const screener_service_1 = require("./screener.service");
const screener_controller_1 = require("./screener.controller");
const ranking_service_1 = require("./ranking/ranking.service");
const assets_service_1 = require("./assets/assets.service");
const screener_repository_1 = require("./persistence/screener.repository");
const alpaca_screener_client_1 = require("./alpaca/alpaca-screener.client");
const active_symbols_service_1 = require("./active/active-symbols.service");
const screener_cron_1 = require("./schedule/screener.cron");
let ScreenerModule = class ScreenerModule {
};
exports.ScreenerModule = ScreenerModule;
exports.ScreenerModule = ScreenerModule = __decorate([
    (0, common_1.Module)({
        providers: [
            screener_repository_1.ScreenerRepository,
            alpaca_screener_client_1.AlpacaScreenerClient,
            assets_service_1.AssetsService,
            active_symbols_service_1.ActiveSymbolsService,
            ranking_service_1.RankingService,
            screener_service_1.ScreenerService,
            screener_cron_1.ScreenerCron,
        ],
        controllers: [screener_controller_1.ScreenerController],
        exports: [screener_service_1.ScreenerService, ranking_service_1.RankingService, screener_repository_1.ScreenerRepository],
    })
], ScreenerModule);
//# sourceMappingURL=screener.module.js.map