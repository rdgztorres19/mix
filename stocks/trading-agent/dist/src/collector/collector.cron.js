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
    async onModuleInit() {
        this.logger.log('🚀 Executing initial Top gainers fetch on startup...');
        await this.collector.runTopGainersCron();
    }
    async runTopGainersCron() {
        this.logger.log('⏰ Top gainers cron (1 min)…');
        await this.collector.runTopGainersCron();
    }
};
exports.CollectorCron = CollectorCron;
__decorate([
    (0, schedule_1.Cron)('0 * 9-16 * * 1-5', { timeZone: 'America/New_York' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CollectorCron.prototype, "runTopGainersCron", null);
exports.CollectorCron = CollectorCron = CollectorCron_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [collector_service_1.CollectorService])
], CollectorCron);
//# sourceMappingURL=collector.cron.js.map