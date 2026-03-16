"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ScannerCron", {
    enumerable: true,
    get: function() {
        return ScannerCron;
    }
});
const _common = require("@nestjs/common");
const _schedule = require("@nestjs/schedule");
const _scannerservice = require("./scanner.service");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
let ScannerCron = class ScannerCron {
    /**
   * Runs every weekday at 8:00am ET (13:00 UTC).
   * Populates the daily watchlist before market open.
   */ async runDailyScanner() {
        this.logger.log('⏰ Daily scanner cron triggered (8:00am ET)...');
        try {
            const candidates = await this.scannerService.runScanner();
            this.latestWatchlist = candidates;
            this.lastRun = new Date();
            this.logger.log(`✅ Daily watchlist ready: ${candidates.length} candidates. Tickers: ${candidates.map((c)=>c.ticker).join(', ')}`);
        } catch (err) {
            this.logger.error('Daily scanner cron failed:', err.message);
        }
    }
    /**
   * Also runs at 8:30am ET (13:30 UTC) for final pre-open refresh.
   */ async runPreOpenRefresh() {
        this.logger.log('🔄 Pre-open scanner refresh (8:30am ET)...');
        try {
            const candidates = await this.scannerService.runScanner();
            this.latestWatchlist = candidates;
            this.lastRun = new Date();
        } catch (err) {
            this.logger.error('Pre-open refresh failed:', err.message);
        }
    }
    getLatestWatchlist() {
        return {
            candidates: this.latestWatchlist,
            lastRun: this.lastRun
        };
    }
    constructor(scannerService){
        this.scannerService = scannerService;
        this.logger = new _common.Logger(ScannerCron.name);
        // Cache the latest watchlist so the agent can access it
        this.latestWatchlist = [];
        this.lastRun = null;
    }
};
_ts_decorate([
    (0, _schedule.Cron)(process.env.SCANNER_CRON || '0 13 * * 1-5'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], ScannerCron.prototype, "runDailyScanner", null);
_ts_decorate([
    (0, _schedule.Cron)('30 13 * * 1-5'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], ScannerCron.prototype, "runPreOpenRefresh", null);
ScannerCron = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _scannerservice.ScannerService === "undefined" ? Object : _scannerservice.ScannerService
    ])
], ScannerCron);

//# sourceMappingURL=scanner.cron.js.map