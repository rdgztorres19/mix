"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AppModule", {
    enumerable: true,
    get: function() {
        return AppModule;
    }
});
const _common = require("@nestjs/common");
const _schedule = require("@nestjs/schedule");
const _config = require("@nestjs/config");
const _ragmodule = require("./rag/rag.module");
const _agentmodule = require("./agent/agent.module");
const _scannermodule = require("./scanner/scanner.module");
const _analysislogmodule = require("./analysis-log/analysis-log.module");
const _cachemodule = require("./cache/cache.module");
const _predictormodule = require("./predictor/predictor.module");
const _collectormodule = require("./collector/collector.module");
const _tradermodule = require("./trader/trader.module");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
let AppModule = class AppModule {
};
AppModule = _ts_decorate([
    (0, _common.Module)({
        imports: [
            _config.ConfigModule.forRoot({
                isGlobal: true
            }),
            _schedule.ScheduleModule.forRoot(),
            _analysislogmodule.AnalysisLogModule,
            _ragmodule.RagModule,
            _agentmodule.AgentModule,
            _scannermodule.ScannerModule,
            _cachemodule.CacheModule,
            _predictormodule.PredictorModule,
            _collectormodule.CollectorModule,
            _tradermodule.TraderModule
        ]
    })
], AppModule);

//# sourceMappingURL=app.module.js.map