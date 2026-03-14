"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketModule = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const alpaca_websocket_service_1 = require("./alpaca-websocket.service");
const websocket_fallback_cron_1 = require("./websocket-fallback.cron");
const websocket_init_service_1 = require("./websocket-init.service");
const scanner_module_1 = require("../scanner/scanner.module");
const collector_module_1 = require("../collector/collector.module");
let WebSocketModule = class WebSocketModule {
};
exports.WebSocketModule = WebSocketModule;
exports.WebSocketModule = WebSocketModule = __decorate([
    (0, common_1.Module)({
        imports: [
            schedule_1.ScheduleModule.forRoot(),
            scanner_module_1.ScannerModule,
            (0, common_1.forwardRef)(() => collector_module_1.CollectorModule),
        ],
        providers: [
            alpaca_websocket_service_1.AlpacaWebSocketService,
            websocket_fallback_cron_1.WebSocketFallbackCron,
            websocket_init_service_1.WebSocketInitService,
            {
                provide: 'WEB_SOCKET_INIT_SERVICE',
                useExisting: websocket_init_service_1.WebSocketInitService,
            },
        ],
        exports: [alpaca_websocket_service_1.AlpacaWebSocketService, websocket_init_service_1.WebSocketInitService],
    })
], WebSocketModule);
//# sourceMappingURL=websocket.module.js.map