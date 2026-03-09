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
var AgentService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentService = void 0;
const common_1 = require("@nestjs/common");
const agentic_pipeline_1 = require("./pipeline/agentic-pipeline");
const fast_pipeline_1 = require("./pipeline/fast-pipeline");
let AgentService = AgentService_1 = class AgentService {
    constructor(agenticPipeline, fastPipeline) {
        this.agenticPipeline = agenticPipeline;
        this.fastPipeline = fastPipeline;
        this.logger = new common_1.Logger(AgentService_1.name);
    }
    async analyze(req) {
        const { ticker, account_size = Number(process.env.DEFAULT_ACCOUNT_SIZE) || 25000, timeframe = '5m', cutoff_ms, fast } = req;
        const tStart = Date.now();
        this.logger.log(`[0.0s] Analyzing ${ticker} | account $${account_size} | ${timeframe}` +
            (cutoff_ms ? ` | SIMULATION up to ${new Date(cutoff_ms).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET` : '') +
            (fast ? ' | FAST (pipeline)' : ''));
        if (fast) {
            return this.fastPipeline.run(req);
        }
        return this.agenticPipeline.run(req);
    }
};
exports.AgentService = AgentService;
exports.AgentService = AgentService = AgentService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [agentic_pipeline_1.AgenticPipeline,
        fast_pipeline_1.FastPipeline])
], AgentService);
//# sourceMappingURL=agent.service.js.map