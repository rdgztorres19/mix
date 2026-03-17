"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollectorModule = void 0;
const common_1 = require("@nestjs/common");
const scanner_module_1 = require("../scanner/scanner.module");
const trader_module_1 = require("../trader/trader.module");
const websocket_module_1 = require("../websocket/websocket.module");
const collector_service_1 = require("./collector.service");
const collector_cron_1 = require("./collector.cron");
const momo_stream_service_1 = require("./momo-stream.service");
const collector_gateway_1 = require("./collector.gateway");
const collector_controller_1 = require("./collector.controller");
const top_gainers_source_service_1 = require("./top-gainers-source.service");
const scanned_tracker_service_1 = require("./tracker/scanned-tracker.service");
const scanned_tracker_cron_1 = require("./tracker/scanned-tracker.cron");
const scanned_tracker_controller_1 = require("./tracker/scanned-tracker.controller");
let CollectorModule = class CollectorModule {
};
exports.CollectorModule = CollectorModule;
exports.CollectorModule = CollectorModule = __decorate([
    (0, common_1.Module)({
        imports: [scanner_module_1.ScannerModule, trader_module_1.TraderModule, (0, common_1.forwardRef)(() => websocket_module_1.WebSocketModule)],
        controllers: [collector_controller_1.CollectorController, scanned_tracker_controller_1.ScannedTrackerController],
        providers: [
            top_gainers_source_service_1.TopGainersSourceService,
            collector_service_1.CollectorService,
            collector_cron_1.CollectorCron,
            momo_stream_service_1.MomoStreamService,
            collector_gateway_1.CollectorGateway,
            scanned_tracker_service_1.ScannedTrackerService,
            scanned_tracker_cron_1.ScannedTrackerCron,
            {
                provide: 'COLLECTOR_SERVICE',
                useExisting: collector_service_1.CollectorService,
            },
        ],
        exports: [collector_service_1.CollectorService, momo_stream_service_1.MomoStreamService, collector_gateway_1.CollectorGateway, scanned_tracker_service_1.ScannedTrackerService, 'COLLECTOR_SERVICE'],
    })
], CollectorModule);
//# sourceMappingURL=collector.module.js.map