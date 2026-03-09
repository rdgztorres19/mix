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
const collector_service_1 = require("./collector.service");
const collector_cron_1 = require("./collector.cron");
const momo_stream_service_1 = require("./momo-stream.service");
const collector_gateway_1 = require("./collector.gateway");
let CollectorModule = class CollectorModule {
};
exports.CollectorModule = CollectorModule;
exports.CollectorModule = CollectorModule = __decorate([
    (0, common_1.Module)({
        imports: [scanner_module_1.ScannerModule],
        providers: [
            collector_service_1.CollectorService,
            collector_cron_1.CollectorCron,
            momo_stream_service_1.MomoStreamService,
            collector_gateway_1.CollectorGateway,
        ],
        exports: [collector_service_1.CollectorService],
    })
], CollectorModule);
//# sourceMappingURL=collector.module.js.map