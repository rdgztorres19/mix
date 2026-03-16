"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "WebSocketModule", {
    enumerable: true,
    get: function() {
        return WebSocketModule;
    }
});
const _common = require("@nestjs/common");
const _schedule = require("@nestjs/schedule");
const _alpacawebsocketservice = require("./alpaca-websocket.service");
const _websocketfallbackcron = require("./websocket-fallback.cron");
const _websocketinitservice = require("./websocket-init.service");
const _scannermodule = require("../scanner/scanner.module");
const _collectormodule = require("../collector/collector.module");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
let WebSocketModule = class WebSocketModule {
};
WebSocketModule = _ts_decorate([
    (0, _common.Module)({
        imports: [
            _schedule.ScheduleModule.forRoot(),
            _scannermodule.ScannerModule,
            (0, _common.forwardRef)(()=>_collectormodule.CollectorModule)
        ],
        providers: [
            _alpacawebsocketservice.AlpacaWebSocketService,
            _websocketfallbackcron.WebSocketFallbackCron,
            _websocketinitservice.WebSocketInitService,
            {
                provide: 'WEB_SOCKET_INIT_SERVICE',
                useExisting: _websocketinitservice.WebSocketInitService
            }
        ],
        exports: [
            _alpacawebsocketservice.AlpacaWebSocketService,
            _websocketinitservice.WebSocketInitService
        ]
    })
], WebSocketModule);

//# sourceMappingURL=websocket.module.js.map