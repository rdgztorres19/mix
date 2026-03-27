/**
 * CollectorCron: scheduled jobs for the collector pipeline.
 *
 * - Every 1 minute during market hours (9:30–16:00 ET ≈ 14:30–21:00 UTC):
 *   Fetch top gainers from TOP_GAINERS_SOURCE (internal screener, HPG, or Alpaca), replace activeSymbols,
 *   add new symbols to collection, refresh Alpaca WebSocket subscriptions.
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
    async onModuleInit() {
        this.logger.log('🚀 Executing initial Top gainers fetch on startup...');
        await this.collector.runTopGainersCron();
    }
    /**
   * Every minute during market hours (9:30–16:00 ET).
   * Fetch top gainers from env source, replace activeSymbols, add new to symbols.
   */ async runTopGainersCron() {
        this.logger.log('⏰ Top gainers cron (1 min)…');
        await this.collector.runTopGainersCron();
    }
    constructor(collector){
        this.collector = collector;
        this.logger = new _common.Logger(CollectorCron.name);
    }
};
_ts_decorate([
    (0, _schedule.Cron)('0 * 9-16 * * 1-5', {
        timeZone: 'America/New_York'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], CollectorCron.prototype, "runTopGainersCron", null);
CollectorCron = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _collectorservice.CollectorService === "undefined" ? Object : _collectorservice.CollectorService
    ])
], CollectorCron);

//# sourceMappingURL=collector.cron.js.map