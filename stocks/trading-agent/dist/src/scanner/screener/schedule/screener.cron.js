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
var ScreenerCron_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScreenerCron = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const ranking_service_1 = require("../ranking/ranking.service");
const et_time_1 = require("../utils/et-time");
let ScreenerCron = ScreenerCron_1 = class ScreenerCron {
    constructor(ranking) {
        this.ranking = ranking;
        this.logger = new common_1.Logger(ScreenerCron_1.name);
    }
    async marketTick() {
        const now = new Date();
        if (!(0, et_time_1.isEtWeekday)(now) || !(0, et_time_1.isEtMarketRankingWindow)(now))
            return;
        try {
        }
        catch (e) {
            this.logger.error(`market screener sync failed: ${e.message}`);
        }
    }
    async postMarketHourly() {
        const now = new Date();
        if (!(0, et_time_1.isEtWeekday)(now) || !(0, et_time_1.isEtPostMarketCacheWindow)(now))
            return;
        try {
            await this.ranking.refreshQuoteCacheOnly();
        }
        catch (e) {
            this.logger.error(`post-market quote refresh failed: ${e.message}`);
        }
    }
};
exports.ScreenerCron = ScreenerCron;
__decorate([
    (0, schedule_1.Cron)('*/1 * * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ScreenerCron.prototype, "marketTick", null);
__decorate([
    (0, schedule_1.Cron)('0 * * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ScreenerCron.prototype, "postMarketHourly", null);
exports.ScreenerCron = ScreenerCron = ScreenerCron_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [ranking_service_1.RankingService])
], ScreenerCron);
//# sourceMappingURL=screener.cron.js.map