"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TraderModule = void 0;
const common_1 = require("@nestjs/common");
const scanner_module_1 = require("../scanner/scanner.module");
const predictor_module_1 = require("../predictor/predictor.module");
const alpaca_trader_service_1 = require("./alpaca-trader.service");
const position_tracker_service_1 = require("./position-tracker.service");
const auto_trader_service_1 = require("./auto-trader.service");
let TraderModule = class TraderModule {
};
exports.TraderModule = TraderModule;
exports.TraderModule = TraderModule = __decorate([
    (0, common_1.Module)({
        imports: [scanner_module_1.ScannerModule, predictor_module_1.PredictorModule],
        providers: [
            alpaca_trader_service_1.AlpacaTraderService,
            position_tracker_service_1.PositionTrackerService,
            auto_trader_service_1.AutoTraderService,
        ],
        exports: [auto_trader_service_1.AutoTraderService, position_tracker_service_1.PositionTrackerService],
    })
], TraderModule);
//# sourceMappingURL=trader.module.js.map