"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "CollectorController", {
    enumerable: true,
    get: function() {
        return CollectorController;
    }
});
const _common = require("@nestjs/common");
const _collectorservice = require("./collector.service");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
let CollectorController = class CollectorController {
    /**
   * POST /collector/sync-today
   * Triggers a MoMo refresh for today's candles (skips after hours).
   */ async syncToday() {
        const result = await this.collector.refreshAllFromMomo({
            force: true
        });
        return {
            ok: true,
            ...result
        };
    }
    constructor(collector){
        this.collector = collector;
    }
};
_ts_decorate([
    (0, _common.Post)('sync-today'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], CollectorController.prototype, "syncToday", null);
CollectorController = _ts_decorate([
    (0, _common.Controller)('collector'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _collectorservice.CollectorService === "undefined" ? Object : _collectorservice.CollectorService
    ])
], CollectorController);

//# sourceMappingURL=collector.controller.js.map