"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const config_1 = require("@nestjs/config");
const rag_module_1 = require("./rag/rag.module");
const agent_module_1 = require("./agent/agent.module");
const scanner_module_1 = require("./scanner/scanner.module");
const analysis_log_module_1 = require("./analysis-log/analysis-log.module");
const cache_module_1 = require("./cache/cache.module");
const predictor_module_1 = require("./predictor/predictor.module");
const collector_module_1 = require("./collector/collector.module");
const trader_module_1 = require("./trader/trader.module");
const websocket_module_1 = require("./websocket/websocket.module");
const screener_module_1 = require("./scanner/screener/screener.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true }),
            schedule_1.ScheduleModule.forRoot(),
            analysis_log_module_1.AnalysisLogModule,
            rag_module_1.RagModule,
            agent_module_1.AgentModule,
            scanner_module_1.ScannerModule,
            websocket_module_1.WebSocketModule,
            cache_module_1.CacheModule,
            predictor_module_1.PredictorModule,
            collector_module_1.CollectorModule,
            trader_module_1.TraderModule,
            screener_module_1.ScreenerModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map