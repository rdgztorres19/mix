"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "CollectorModule", {
    enumerable: true,
    get: function() {
        return CollectorModule;
    }
});
const _common = require("@nestjs/common");
const _scannermodule = require("../scanner/scanner.module");
const _screenermodule = require("../scanner/screener/screener.module");
const _tradermodule = require("../trader/trader.module");
const _websocketmodule = require("../websocket/websocket.module");
const _collectorservice = require("./collector.service");
const _collectorcron = require("./collector.cron");
const _collectorgateway = require("./collector.gateway");
const _collectorcontroller = require("./collector.controller");
const _topgainerssourceservice = require("./top-gainers-source.service");
const _scannedtrackerservice = require("./tracker/scanned-tracker.service");
const _scannedtrackercron = require("./tracker/scanned-tracker.cron");
const _scannedtrackercontroller = require("./tracker/scanned-tracker.controller");
const _collectorfeaturepreviewservice = require("./collector-feature-preview.service");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
let CollectorModule = class CollectorModule {
};
CollectorModule = _ts_decorate([
    (0, _common.Module)({
        imports: [
            _scannermodule.ScannerModule,
            _screenermodule.ScreenerModule,
            _tradermodule.TraderModule,
            (0, _common.forwardRef)(()=>_websocketmodule.WebSocketModule)
        ],
        controllers: [
            _collectorcontroller.CollectorController,
            _scannedtrackercontroller.ScannedTrackerController
        ],
        providers: [
            _topgainerssourceservice.TopGainersSourceService,
            _collectorservice.CollectorService,
            _collectorfeaturepreviewservice.CollectorFeaturePreviewService,
            _collectorcron.CollectorCron,
            _collectorgateway.CollectorGateway,
            _scannedtrackerservice.ScannedTrackerService,
            _scannedtrackercron.ScannedTrackerCron,
            {
                provide: 'COLLECTOR_SERVICE',
                useExisting: _collectorservice.CollectorService
            }
        ],
        exports: [
            _collectorservice.CollectorService,
            _collectorgateway.CollectorGateway,
            _scannedtrackerservice.ScannedTrackerService,
            'COLLECTOR_SERVICE'
        ]
    })
], CollectorModule);

//# sourceMappingURL=collector.module.js.map