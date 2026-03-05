"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AgentController", {
    enumerable: true,
    get: function() {
        return AgentController;
    }
});
const _common = require("@nestjs/common");
const _classvalidator = require("class-validator");
const _agentservice = require("./agent.service");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
function _ts_param(paramIndex, decorator) {
    return function(target, key) {
        decorator(target, key, paramIndex);
    };
}
let AnalyzeDto = class AnalyzeDto {
};
_ts_decorate([
    (0, _classvalidator.IsString)(),
    _ts_metadata("design:type", String)
], AnalyzeDto.prototype, "ticker", void 0);
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    (0, _classvalidator.IsNumber)(),
    (0, _classvalidator.Min)(1000),
    _ts_metadata("design:type", Number)
], AnalyzeDto.prototype, "account_size", void 0);
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    (0, _classvalidator.IsNumber)(),
    _ts_metadata("design:type", Number)
], AnalyzeDto.prototype, "cutoff_ms", void 0);
let AgentController = class AgentController {
    /**
   * POST /agent/analyze
   * Body: { "ticker": "NVDA", "account_size": 25000 }
   *
   * Runs the full LangChain tool-calling agent to analyze a stock for day trading.
   * Returns: decision, entry, stop, targets, share size, R/R ratio, justification.
   */ async analyze(body) {
        if (!body.ticker) {
            throw new _common.HttpException('ticker is required', _common.HttpStatus.BAD_REQUEST);
        }
        this.logger.log(`POST /agent/analyze → ${body.ticker.toUpperCase()}`);
        try {
            const result = await this.agentService.analyze({
                ticker: body.ticker.toUpperCase(),
                account_size: body.account_size,
                cutoff_ms: body.cutoff_ms
            });
            return result;
        } catch (err) {
            this.logger.error(`Analysis failed for ${body.ticker}:`, err.message);
            throw new _common.HttpException(`Analysis failed: ${err.message}`, _common.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    constructor(agentService){
        this.agentService = agentService;
        this.logger = new _common.Logger(AgentController.name);
    }
};
_ts_decorate([
    (0, _common.Post)('analyze'),
    _ts_param(0, (0, _common.Body)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof AnalyzeDto === "undefined" ? Object : AnalyzeDto
    ]),
    _ts_metadata("design:returntype", Promise)
], AgentController.prototype, "analyze", null);
AgentController = _ts_decorate([
    (0, _common.Controller)('agent'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _agentservice.AgentService === "undefined" ? Object : _agentservice.AgentService
    ])
], AgentController);

//# sourceMappingURL=agent.controller.js.map