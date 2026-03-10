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
const _tradermodule = require("../trader/trader.module");
const _collectorservice = require("./collector.service");
const _collectorcron = require("./collector.cron");
const _momostreamservice = require("./momo-stream.service");
const _collectorgateway = require("./collector.gateway");
const _collectorcontroller = require("./collector.controller");
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
            _tradermodule.TraderModule
        ],
        controllers: [
            _collectorcontroller.CollectorController
        ],
        providers: [
            _collectorservice.CollectorService,
            _collectorcron.CollectorCron,
            _momostreamservice.MomoStreamService,
            _collectorgateway.CollectorGateway
        ],
        exports: [
            _collectorservice.CollectorService
        ]
    })
], CollectorModule);

//# sourceMappingURL=collector.module.js.map