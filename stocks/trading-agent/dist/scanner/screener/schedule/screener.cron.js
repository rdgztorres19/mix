"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ScreenerCron", {
    enumerable: true,
    get: function() {
        return ScreenerCron;
    }
});
const _common = require("@nestjs/common");
const _schedule = require("@nestjs/schedule");
const _rankingservice = require("../ranking/ranking.service");
const _ettime = require("../utils/et-time");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
let ScreenerCron = class ScreenerCron {
    //Execute every minute during market hours
    async marketTick() {
        const now = new Date();
        if (!(0, _ettime.isEtWeekday)(now) || !(0, _ettime.isEtMarketRankingWindow)(now)) return;
        try {
        //await this.ranking.syncAllRankings();
        } catch (e) {
            this.logger.error(`market screener sync failed: ${e.message}`);
        }
    }
    //Execute every hour during post-market hours
    async postMarketHourly() {
        const now = new Date();
        if (!(0, _ettime.isEtWeekday)(now) || !(0, _ettime.isEtPostMarketCacheWindow)(now)) return;
        try {
            await this.ranking.refreshQuoteCacheOnly();
        } catch (e) {
            this.logger.error(`post-market quote refresh failed: ${e.message}`);
        }
    }
    constructor(ranking){
        this.ranking = ranking;
        this.logger = new _common.Logger(ScreenerCron.name);
    }
};
_ts_decorate([
    (0, _schedule.Cron)('*/1 * * * *'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], ScreenerCron.prototype, "marketTick", null);
_ts_decorate([
    (0, _schedule.Cron)('0 * * * *'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], ScreenerCron.prototype, "postMarketHourly", null);
ScreenerCron = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _rankingservice.RankingService === "undefined" ? Object : _rankingservice.RankingService
    ])
], ScreenerCron);

//# sourceMappingURL=screener.cron.js.map