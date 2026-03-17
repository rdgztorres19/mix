"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentModule = void 0;
const common_1 = require("@nestjs/common");
const openai_1 = require("@langchain/openai");
const agent_service_1 = require("./agent.service");
const agent_controller_1 = require("./agent.controller");
const rag_module_1 = require("../rag/rag.module");
const scanner_module_1 = require("../scanner/scanner.module");
const cache_module_1 = require("../cache/cache.module");
const analysis_response_builder_1 = require("./pipeline/analysis-response.builder");
const agentic_pipeline_1 = require("./pipeline/agentic-pipeline");
const fast_pipeline_1 = require("./pipeline/fast-pipeline");
let AgentModule = class AgentModule {
};
exports.AgentModule = AgentModule;
exports.AgentModule = AgentModule = __decorate([
    (0, common_1.Module)({
        imports: [rag_module_1.RagModule, scanner_module_1.ScannerModule, cache_module_1.CacheModule],
        providers: [
            {
                provide: openai_1.ChatOpenAI,
                useFactory: () => new openai_1.ChatOpenAI({
                    model: 'gpt-4o-mini',
                    temperature: 0,
                    apiKey: process.env.OPENAI_API_KEY,
                }),
            },
            analysis_response_builder_1.AnalysisResponseBuilder,
            agentic_pipeline_1.AgenticPipeline,
            fast_pipeline_1.FastPipeline,
            agent_service_1.AgentService,
        ],
        controllers: [agent_controller_1.AgentController],
    })
], AgentModule);
//# sourceMappingURL=agent.module.js.map