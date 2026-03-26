"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScreenerController = void 0;
const common_1 = require("@nestjs/common");
const screener_service_1 = require("./screener.service");
let ScreenerController = class ScreenerController {
    constructor(screenerService) {
        this.screenerService = screenerService;
    }
    getGappers() {
        return this.screenerService.getTopGappers();
    }
    getGainers() {
        return this.screenerService.getGainersDetailed();
    }
    getGainersSession() {
        return this.screenerService.getTopGainers();
    }
    getCombined() {
        return this.screenerService.getCombinedSymbols();
    }
    getActive() {
        return this.screenerService.getActiveDetailed();
    }
    getHighs() {
        return this.screenerService.getTopHighs();
    }
    getStatus() {
        return this.screenerService.getStatus();
    }
    async forceSync() {
        return this.screenerService.forceSync();
    }
};
exports.ScreenerController = ScreenerController;
__decorate([
    (0, common_1.Get)('gappers'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ScreenerController.prototype, "getGappers", null);
__decorate([
    (0, common_1.Get)('gainers'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ScreenerController.prototype, "getGainers", null);
__decorate([
    (0, common_1.Get)('gainers/session'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ScreenerController.prototype, "getGainersSession", null);
__decorate([
    (0, common_1.Get)('combined'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ScreenerController.prototype, "getCombined", null);
__decorate([
    (0, common_1.Get)(['active', 'active-symbols']),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ScreenerController.prototype, "getActive", null);
__decorate([
    (0, common_1.Get)('highs'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ScreenerController.prototype, "getHighs", null);
__decorate([
    (0, common_1.Get)('status'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ScreenerController.prototype, "getStatus", null);
__decorate([
    (0, common_1.Post)('force-sync'),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ScreenerController.prototype, "forceSync", null);
exports.ScreenerController = ScreenerController = __decorate([
    (0, common_1.Controller)('screener'),
    __metadata("design:paramtypes", [screener_service_1.ScreenerService])
], ScreenerController);
//# sourceMappingURL=screener.controller.js.map