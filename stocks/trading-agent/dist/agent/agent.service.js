"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AgentService", {
    enumerable: true,
    get: function() {
        return AgentService;
    }
});
const _common = require("@nestjs/common");
const _agenticpipeline = require("./pipeline/agentic-pipeline");
const _fastpipeline = require("./pipeline/fast-pipeline");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
let AgentService = class AgentService {
    async analyze(req) {
        const { ticker, account_size = Number(process.env.DEFAULT_ACCOUNT_SIZE) || 25000, timeframe = '5m', cutoff_ms, fast } = req;
        const tStart = Date.now();
        this.logger.log(`[0.0s] Analyzing ${ticker} | account $${account_size} | ${timeframe}` + (cutoff_ms ? ` | SIMULATION up to ${new Date(cutoff_ms).toLocaleString('en-US', {
            timeZone: 'America/New_York'
        })} ET` : '') + (fast ? ' | FAST (pipeline)' : ''));
        if (fast) {
            return this.fastPipeline.run(req);
        }
        return this.agenticPipeline.run(req);
    }
    constructor(agenticPipeline, fastPipeline){
        this.agenticPipeline = agenticPipeline;
        this.fastPipeline = fastPipeline;
        this.logger = new _common.Logger(AgentService.name);
    }
};
AgentService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _agenticpipeline.AgenticPipeline === "undefined" ? Object : _agenticpipeline.AgenticPipeline,
        typeof _fastpipeline.FastPipeline === "undefined" ? Object : _fastpipeline.FastPipeline
    ])
], AgentService);

//# sourceMappingURL=agent.service.js.map