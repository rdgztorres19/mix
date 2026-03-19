"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ScannedTrackerController", {
    enumerable: true,
    get: function() {
        return ScannedTrackerController;
    }
});
const _common = require("@nestjs/common");
const _scannedtrackerservice = require("./scanned-tracker.service");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
let ScannedTrackerController = class ScannedTrackerController {
    getTrackedSymbolsToday() {
        return this.trackerService.getTrackedSymbols();
    }
    constructor(trackerService){
        this.trackerService = trackerService;
    }
};
_ts_decorate([
    (0, _common.Get)('today'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Array)
], ScannedTrackerController.prototype, "getTrackedSymbolsToday", null);
ScannedTrackerController = _ts_decorate([
    (0, _common.Controller)('scanner-tracker'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _scannedtrackerservice.ScannedTrackerService === "undefined" ? Object : _scannedtrackerservice.ScannedTrackerService
    ])
], ScannedTrackerController);

//# sourceMappingURL=scanned-tracker.controller.js.map