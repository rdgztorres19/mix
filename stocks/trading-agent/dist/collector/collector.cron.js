/**
 * CollectorCron: scheduled jobs for the collector pipeline.
 *
 * - 8:00 AM ET (12:00 UTC): initial daily MoMo scan
 * - Every 30 minutes during market hours: refresh scan for new tickers
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "CollectorCron", {
    enumerable: true,
    get: function() {
        return CollectorCron;
    }
});
const _common = require("@nestjs/common");
const _schedule = require("@nestjs/schedule");
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
let CollectorCron = class CollectorCron {
    /**
   * 8:00 AM ET = 12:00 UTC (winter) / 12:00 UTC (summer, DST).
   * Pre-market scan to seed the initial watchlist.
   */ async runDailyScan() {
        this.logger.log('⏰ Daily pre-market MoMo scan (8:00 AM ET)…');
        await this.collector.resetActiveSymbols();
        await this.collector.scanMomo();
    }
    /**
   * Every 5 minutes during 9:00–20:00 UTC (covers 4 AM – 4 PM ET).
   * Catches new movers that appear during the trading day.
   */ async runPeriodicScan() {
        this.logger.log('🔄 Periodic MoMo scan…');
        await this.collector.scanMomo();
    }
    /**
   * Every 5 minutes during market hours: refresh candles from MoMo
   * to fill gaps that Alpaca IEX free tier misses.
   */ async runMomoRefresh() {
        this.logger.log('🕐 MoMo candle refresh (filling IEX gaps)…');
        await this.collector.refreshAllFromMomo();
    }
    constructor(collector){
        this.collector = collector;
        this.logger = new _common.Logger(CollectorCron.name);
    }
};
_ts_decorate([
    (0, _schedule.Cron)('0 12 * * 1-5'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], CollectorCron.prototype, "runDailyScan", null);
_ts_decorate([
    (0, _schedule.Cron)('*/30 9-20 * * 1-5'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], CollectorCron.prototype, "runPeriodicScan", null);
_ts_decorate([
    (0, _schedule.Cron)('*/60 13-21 * * 1-5'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], CollectorCron.prototype, "runMomoRefresh", null);
CollectorCron = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _collectorservice.CollectorService === "undefined" ? Object : _collectorservice.CollectorService
    ])
], CollectorCron);

//# sourceMappingURL=collector.cron.js.map