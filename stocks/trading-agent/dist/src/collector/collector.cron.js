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
var CollectorCron_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollectorCron = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const collector_service_1 = require("./collector.service");
let CollectorCron = CollectorCron_1 = class CollectorCron {
    constructor(collector) {
        this.collector = collector;
        this.logger = new common_1.Logger(CollectorCron_1.name);
    }
    async runDailyScan() {
        this.logger.log('⏰ Daily pre-market MoMo scan (8:00 AM ET)…');
        await this.collector.resetActiveSymbols();
        await this.collector.scanMomo();
    }
    async runPeriodicScan() {
        this.logger.log('🔄 Periodic MoMo scan…');
        await this.collector.scanMomo();
    }
    async runMomoRefresh() {
        this.logger.log('🕐 MoMo candle refresh (filling IEX gaps)…');
        await this.collector.refreshAllFromMomo();
    }
};
exports.CollectorCron = CollectorCron;
__decorate([
    (0, schedule_1.Cron)('0 12 * * 1-5'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CollectorCron.prototype, "runDailyScan", null);
__decorate([
    (0, schedule_1.Cron)('*/30 9-20 * * 1-5'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CollectorCron.prototype, "runPeriodicScan", null);
__decorate([
    (0, schedule_1.Cron)('*/60 13-21 * * 1-5'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CollectorCron.prototype, "runMomoRefresh", null);
exports.CollectorCron = CollectorCron = CollectorCron_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [collector_service_1.CollectorService])
], CollectorCron);
//# sourceMappingURL=collector.cron.js.map