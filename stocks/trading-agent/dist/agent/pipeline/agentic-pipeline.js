"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AgenticPipeline", {
    enumerable: true,
    get: function() {
        return AgenticPipeline;
    }
});
const _common = require("@nestjs/common");
const _openai = require("@langchain/openai");
const _messages = require("@langchain/core/messages");
const _ragservice = require("../../rag/rag.service");
const _scannerservice = require("../../scanner/scanner.service");
const _analysislogservice = require("../../analysis-log/analysis-log.service");
const _ragtool = require("../tools/rag.tool");
const _scannertool = require("../tools/scanner.tool");
const _rulestool = require("../tools/rules.tool");
const _newstool = require("../tools/news.tool");
const _pythontool = require("../tools/python.tool");
const _prompts = require("./prompts");
const _analysisresponsebuilder = require("./analysis-response.builder");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
const MAX_ITERATIONS = 8;
const LLM_TIMEOUT_MS = 120_000;
let AgenticPipeline = class AgenticPipeline {
    async run(req) {
        const { ticker, account_size = Number(process.env.DEFAULT_ACCOUNT_SIZE) || 25000, cutoff_ms } = req;
        const tStart = Date.now();
        const ragTool = (0, _ragtool.createRagTool)(this.ragService);
        const scannerTool = (0, _scannertool.createScannerTool)(this.scannerService, cutoff_ms, req.timeframe ?? '5m');
        const rulesTool = (0, _rulestool.createRulesTool)();
        const newsTool = (0, _newstool.createNewsTool)();
        const pythonTool = (0, _pythontool.createPythonTool)();
        const tools = [
            ragTool,
            scannerTool,
            rulesTool,
            newsTool,
            pythonTool
        ];
        const toolsByName = {
            search_trading_knowledge: ragTool,
            get_stock_data: scannerTool,
            apply_trading_rules: rulesTool,
            analyze_news_catalyst: newsTool,
            run_python: pythonTool
        };
        const llmWithTools = this.llm.bindTools(tools);
        const messages = [
            new _messages.SystemMessage(_prompts.SYSTEM_PROMPT),
            new _messages.HumanMessage(`Analyze ${ticker.toUpperCase()} for a trading opportunity. My account size is $${account_size.toLocaleString()}.`)
        ];
        let toolCallsCount = 0;
        let ragChunksUsed = 0;
        for(let i = 0; i < MAX_ITERATIONS; i++){
            const tLlm = Date.now();
            const response = await llmWithTools.invoke(messages, {
                timeout: LLM_TIMEOUT_MS
            });
            this.logger.log(`[${((Date.now() - tStart) / 1000).toFixed(1)}s] LLM call #${i + 1} took ${((Date.now() - tLlm) / 1000).toFixed(1)}s`);
            messages.push(response);
            if (!response.tool_calls || response.tool_calls.length === 0) {
                this.logger.log(`[${((Date.now() - tStart) / 1000).toFixed(1)}s] Done. Total: ${toolCallsCount} tool calls.`);
                break;
            }
            const tTools = Date.now();
            const toolResults = await Promise.all(response.tool_calls.map(async (tc)=>{
                const toolFn = toolsByName[tc.name];
                if (!toolFn) {
                    return {
                        tc,
                        content: `Unknown tool: ${tc.name}`,
                        ragUsed: false
                    };
                }
                try {
                    const result = await toolFn.invoke(tc.args);
                    return {
                        tc,
                        content: typeof result === 'string' ? result : JSON.stringify(result),
                        ragUsed: tc.name === 'search_trading_knowledge'
                    };
                } catch (err) {
                    this.logger.error(`Tool ${tc.name} error:`, err.message);
                    return {
                        tc,
                        content: `Tool error: ${err.message}`,
                        ragUsed: false
                    };
                }
            }));
            this.logger.log(`[${((Date.now() - tStart) / 1000).toFixed(1)}s] Tools done in ${((Date.now() - tTools) / 1000).toFixed(1)}s (parallel)`);
            for (const { tc, content, ragUsed } of toolResults){
                toolCallsCount++;
                this.logger.log(`[${((Date.now() - tStart) / 1000).toFixed(1)}s] Tool [${toolCallsCount}]: ${tc.name} ✓`);
                if (ragUsed) ragChunksUsed++;
                messages.push(new _messages.ToolMessage({
                    tool_call_id: tc.id,
                    content
                }));
            }
        }
        const finalMsg = messages.filter((m)=>m instanceof _messages.AIMessage && (!m.tool_calls || m.tool_calls.length === 0)).pop();
        const rawAnalysis = finalMsg?.content?.toString() || 'No analysis generated';
        const parsed = this.responseBuilder.parse(rawAnalysis, ticker, account_size);
        const durationMs = Date.now() - tStart;
        const momentoEt = cutoff_ms ? new Date(cutoff_ms).toLocaleString('en-US', {
            timeZone: 'America/New_York',
            dateStyle: 'short',
            timeStyle: 'short'
        }) + ' ET' : new Date().toLocaleString('en-US', {
            timeZone: 'America/New_York',
            dateStyle: 'short',
            timeStyle: 'short'
        }) + ' ET';
        const result = {
            ...parsed,
            ticker: ticker.toUpperCase(),
            momento_analisis_et: momentoEt,
            rag_chunks_usados: ragChunksUsed,
            tool_calls_made: toolCallsCount,
            raw_analysis: rawAnalysis
        };
        this.analysisLog.insert({
            ticker: ticker.toUpperCase(),
            account_size,
            cutoff_ms: cutoff_ms ?? null,
            request_prompt: `Analyze ${ticker.toUpperCase()} for a trading opportunity. My account size is $${account_size.toLocaleString()}.`,
            messages_json: JSON.stringify(this.serializeMessages(messages)),
            response_json: JSON.stringify(result),
            raw_analysis: rawAnalysis,
            tool_calls_count: toolCallsCount,
            rag_chunks_used: ragChunksUsed,
            duration_ms: durationMs
        });
        this.logger.log(`[${(durationMs / 1000).toFixed(1)}s] ANALYSIS COMPLETE for ${ticker}`);
        return result;
    }
    serializeMessages(messages) {
        return messages.map((m)=>{
            const type = (m.constructor?.name ?? 'unknown').replace('Message', '').toLowerCase();
            const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
            const obj = {
                type,
                content: content.slice(0, 100_000)
            };
            if (m.tool_calls?.length) obj.tool_calls = m.tool_calls;
            if (m.tool_call_id) obj.tool_call_id = m.tool_call_id;
            return obj;
        });
    }
    constructor(ragService, scannerService, analysisLog, responseBuilder, llm){
        this.ragService = ragService;
        this.scannerService = scannerService;
        this.analysisLog = analysisLog;
        this.responseBuilder = responseBuilder;
        this.llm = llm;
        this.logger = new _common.Logger(AgenticPipeline.name);
    }
};
AgenticPipeline = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _ragservice.RagService === "undefined" ? Object : _ragservice.RagService,
        typeof _scannerservice.ScannerService === "undefined" ? Object : _scannerservice.ScannerService,
        typeof _analysislogservice.AnalysisLogService === "undefined" ? Object : _analysislogservice.AnalysisLogService,
        typeof _analysisresponsebuilder.AnalysisResponseBuilder === "undefined" ? Object : _analysisresponsebuilder.AnalysisResponseBuilder,
        typeof _openai.ChatOpenAI === "undefined" ? Object : _openai.ChatOpenAI
    ])
], AgenticPipeline);

//# sourceMappingURL=agentic-pipeline.js.map