"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AgentModule", {
    enumerable: true,
    get: function() {
        return AgentModule;
    }
});
const _common = require("@nestjs/common");
const _openai = require("@langchain/openai");
const _agentservice = require("./agent.service");
const _agentcontroller = require("./agent.controller");
const _ragmodule = require("../rag/rag.module");
const _scannermodule = require("../scanner/scanner.module");
const _cachemodule = require("../cache/cache.module");
const _analysisresponsebuilder = require("./pipeline/analysis-response.builder");
const _agenticpipeline = require("./pipeline/agentic-pipeline");
const _fastpipeline = require("./pipeline/fast-pipeline");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
let AgentModule = class AgentModule {
};
AgentModule = _ts_decorate([
    (0, _common.Module)({
        imports: [
            _ragmodule.RagModule,
            _scannermodule.ScannerModule,
            _cachemodule.CacheModule
        ],
        providers: [
            {
                provide: _openai.ChatOpenAI,
                useFactory: ()=>new _openai.ChatOpenAI({
                        model: 'gpt-4o-mini',
                        temperature: 0,
                        apiKey: process.env.OPENAI_API_KEY
                    })
            },
            _analysisresponsebuilder.AnalysisResponseBuilder,
            _agenticpipeline.AgenticPipeline,
            _fastpipeline.FastPipeline,
            _agentservice.AgentService
        ],
        controllers: [
            _agentcontroller.AgentController
        ]
    })
], AgentModule);

//# sourceMappingURL=agent.module.js.map