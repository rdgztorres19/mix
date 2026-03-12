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
var ScannerCron_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScannerCron = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const scanner_service_1 = require("./scanner.service");
let ScannerCron = ScannerCron_1 = class ScannerCron {
    constructor(scannerService) {
        this.scannerService = scannerService;
        this.logger = new common_1.Logger(ScannerCron_1.name);
        this.latestWatchlist = [];
        this.lastRun = null;
    }
    async runDailyScanner() {
        this.logger.log('⏰ Daily scanner cron triggered (8:00am ET)...');
        try {
            const candidates = await this.scannerService.runScanner();
            this.latestWatchlist = candidates;
            this.lastRun = new Date();
            this.logger.log(`✅ Daily watchlist ready: ${candidates.length} candidates. Tickers: ${candidates.map((c) => c.ticker).join(', ')}`);
        }
        catch (err) {
            this.logger.error('Daily scanner cron failed:', err.message);
        }
    }
    async runPreOpenRefresh() {
        this.logger.log('🔄 Pre-open scanner refresh (8:30am ET)...');
        try {
            const candidates = await this.scannerService.runScanner();
            this.latestWatchlist = candidates;
            this.lastRun = new Date();
        }
        catch (err) {
            this.logger.error('Pre-open refresh failed:', err.message);
        }
    }
    getLatestWatchlist() {
        return { candidates: this.latestWatchlist, lastRun: this.lastRun };
    }
};
exports.ScannerCron = ScannerCron;
__decorate([
    (0, schedule_1.Cron)(process.env.SCANNER_CRON || '0 13 * * 1-5'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ScannerCron.prototype, "runDailyScanner", null);
__decorate([
    (0, schedule_1.Cron)('30 13 * * 1-5'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ScannerCron.prototype, "runPreOpenRefresh", null);
exports.ScannerCron = ScannerCron = ScannerCron_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [scanner_service_1.ScannerService])
], ScannerCron);
//# sourceMappingURL=scanner.cron.js.map