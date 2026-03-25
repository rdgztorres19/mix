"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ScreenerController", {
    enumerable: true,
    get: function() {
        return ScreenerController;
    }
});
const _common = require("@nestjs/common");
const _screenerservice = require("./screener.service");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
let ScreenerController = class ScreenerController {
    getGappers() {
        return this.screenerService.getTopGappers();
    }
    getGainers() {
        return this.screenerService.getTopGainers();
    }
    getCombined() {
        return this.screenerService.getCombinedSymbols();
    }
    async forceSync() {
        return this.screenerService.forceSync();
    }
    constructor(screenerService){
        this.screenerService = screenerService;
    }
};
_ts_decorate([
    (0, _common.Get)('gappers'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], ScreenerController.prototype, "getGappers", null);
_ts_decorate([
    (0, _common.Get)('gainers'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], ScreenerController.prototype, "getGainers", null);
_ts_decorate([
    (0, _common.Get)('combined'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], ScreenerController.prototype, "getCombined", null);
_ts_decorate([
    (0, _common.Post)('force-sync'),
    (0, _common.HttpCode)(200),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], ScreenerController.prototype, "forceSync", null);
ScreenerController = _ts_decorate([
    (0, _common.Controller)('screener'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _screenerservice.ScreenerService === "undefined" ? Object : _screenerservice.ScreenerService
    ])
], ScreenerController);

//# sourceMappingURL=screener.controller.js.map