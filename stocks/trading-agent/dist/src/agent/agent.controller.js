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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var AgentController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentController = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const agent_service_1 = require("./agent.service");
const analysis_log_service_1 = require("../analysis-log/analysis-log.service");
const news_cache_service_1 = require("../cache/news-cache.service");
class AnalyzeDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AnalyzeDto.prototype, "ticker", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(1000),
    __metadata("design:type", Number)
], AnalyzeDto.prototype, "account_size", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AnalyzeDto.prototype, "timeframe", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], AnalyzeDto.prototype, "cutoff_ms", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], AnalyzeDto.prototype, "fast", void 0);
let AgentController = AgentController_1 = class AgentController {
    constructor(agentService, analysisLog, newsCache) {
        this.agentService = agentService;
        this.analysisLog = analysisLog;
        this.newsCache = newsCache;
        this.logger = new common_1.Logger(AgentController_1.name);
    }
    async analyze(body) {
        if (!body.ticker) {
            throw new common_1.HttpException('ticker is required', common_1.HttpStatus.BAD_REQUEST);
        }
        this.logger.log(`POST /agent/analyze → ${body.ticker.toUpperCase()}`);
        try {
            const result = await this.agentService.analyze({
                ticker: body.ticker.toUpperCase(),
                account_size: body.account_size,
                timeframe: body.timeframe ?? '5m',
                cutoff_ms: body.cutoff_ms,
                fast: body.fast,
            });
            return result;
        }
        catch (err) {
            this.logger.error(`Analysis failed for ${body.ticker}:`, err.message);
            throw new common_1.HttpException(`Analysis failed: ${err.message}`, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async getLogs(limit, ticker) {
        const l = limit ? parseInt(limit, 10) : 50;
        return this.analysisLog.list(l, ticker);
    }
    async getLogById(id) {
        const entry = await this.analysisLog.getById(parseInt(id, 10));
        if (!entry) {
            throw new common_1.HttpException('Log not found', common_1.HttpStatus.NOT_FOUND);
        }
        return entry;
    }
    async getCacheStatus(ticker) {
        const cached = await this.newsCache.get(ticker);
        const ttl = await this.newsCache.ttlRemaining(ticker);
        if (!cached) {
            return { ticker: ticker.toUpperCase(), cached: false, ttl_remaining_sec: ttl };
        }
        return {
            ticker: ticker.toUpperCase(),
            cached: true,
            ttl_remaining_sec: ttl,
            age_sec: Math.round((Date.now() - cached.cached_at) / 1000),
            catalyst: cached,
        };
    }
    async invalidateCache(ticker) {
        await this.newsCache.invalidate(ticker);
        return { ticker: ticker.toUpperCase(), invalidated: true };
    }
};
exports.AgentController = AgentController;
__decorate([
    (0, common_1.Post)('analyze'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [AnalyzeDto]),
    __metadata("design:returntype", Promise)
], AgentController.prototype, "analyze", null);
__decorate([
    (0, common_1.Get)('logs'),
    __param(0, (0, common_1.Query)('limit')),
    __param(1, (0, common_1.Query)('ticker')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AgentController.prototype, "getLogs", null);
__decorate([
    (0, common_1.Get)('logs/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AgentController.prototype, "getLogById", null);
__decorate([
    (0, common_1.Get)('cache/:ticker'),
    __param(0, (0, common_1.Param)('ticker')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AgentController.prototype, "getCacheStatus", null);
__decorate([
    (0, common_1.Delete)('cache/:ticker'),
    __param(0, (0, common_1.Param)('ticker')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AgentController.prototype, "invalidateCache", null);
exports.AgentController = AgentController = AgentController_1 = __decorate([
    (0, common_1.Controller)('agent'),
    __metadata("design:paramtypes", [agent_service_1.AgentService,
        analysis_log_service_1.AnalysisLogService,
        news_cache_service_1.NewsCacheService])
], AgentController);
//# sourceMappingURL=agent.controller.js.map