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
const _openai = require("@langchain/openai");
const _messages = require("@langchain/core/messages");
const _ragservice = require("../rag/rag.service");
const _scannerservice = require("../scanner/scanner.service");
const _ragtool = require("./tools/rag.tool");
const _scannertool = require("./tools/scanner.tool");
const _rulestool = require("./tools/rules.tool");
const _newstool = require("./tools/news.tool");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
// const SYSTEM_PROMPT = `You are an expert day trader assistant. You have access to four tools:
// 1. search_trading_knowledge: search your knowledge base for trading strategies, rules, and criteria
// 2. get_stock_data: get real-time stock data from momoscreener.com (price, VWAP, EMAs, volume, candles, HOD/LOD)
// 3. apply_trading_rules: apply deterministic trading rules to identify strategy and calculate levels
// 4. analyze_news_catalyst: fetch and categorize recent news — determines if the move has a fundamental catalyst
//
// Your job is to analyze a stock and decide: should the trader prepare an entry, monitor it, or avoid it?
//
// WORKFLOW (always follow this order):
// 1. FIRST call get_stock_data to get current price levels and technicals
// 2. SECOND call analyze_news_catalyst to understand WHY the stock is moving — catalyst strength is critical
// 3. THEN call apply_trading_rules with the data to get strategy identification and levels
// 4. THEN call search_trading_knowledge to get detailed rules for the identified strategy
// 5. If needed, call search_trading_knowledge again for entry/exit specifics or risk management
// 6. FINALLY synthesize everything into a clear decision
//
// RULES YOU MUST FOLLOW:
// - Never recommend entering a trade without a clear stop loss
// - If R/R ratio < 2:1, recommend MONITOREAR (not NO_OPERAR unless other issues)
// - If session is after hours or pre-market, recommend NO_OPERAR
// - If relative volume < 3x, recommend NO_OPERAR
// - If analyze_news_catalyst returns NONE or WEAK catalyst, recommend NO_OPERAR or reduce size significantly
// - If analyze_news_catalyst detects a dilutive event (offering/secondary), always NO_OPERAR on long side
// - If analyze_news_catalyst returns STRONG, this is a "Stock in Play" — higher conviction setups allowed
// - Always explain your reasoning in Spanish (the user's language)
// - Be direct and actionable - give exact prices, not vague descriptions
//
// CRITICAL — When decision is MONITOREAR or NO_OPERAR you MUST still provide:
// 1. estrategia_mas_probable: The most likely strategy that is forming (e.g., Bull Flag, ABCD, ORB short, VWAP pullback). Even if not ready, identify what setup you see evolving.
// 2. esperar_para_validar: What specific conditions or signals the trader should wait for to validate the setup before entering. Be concrete: price levels, candle patterns, volume confirmation, VWAP cross, etc.
//
// At the end, summarize in JSON format (inside triple backticks):
// \`\`\`json
// {
//   "decision": "PREPARAR_ENTRADA|MONITOREAR|NO_OPERAR",
//   "estrategia": "Bull Flag|ABCD|ORB|VWAP Reversal|etc|null",
//   "estrategia_mas_probable": "La estrategia más probable que se está formando (siempre obligatorio)",
//   "esperar_para_validar": "Qué esperar para validar la entrada: niveles, patrones, señales concretas",
//   "entry": 0.00,
//   "stop": 0.00,
//   "target_1": 0.00,
//   "target_2": 0.00,
//   "share_size": 0,
//   "riesgo_total": 0.00,
//   "ratio_rr": 0.0,
//   "sesion": "THE_OPEN|LATE_MORNING|MIDDAY|THE_CLOSE|etc",
//   "justificacion": "Breve explicación en español",
//   "alertas": ["lista de alertas o condiciones a vigilar"]
// }
// \`\`\``;
const SYSTEM_PROMPT = `Expert day trader. Tools: get_stock_data, analyze_news_catalyst, apply_trading_rules, search_trading_knowledge.

WORKFLOW: 1) get_stock_data 2) analyze_news_catalyst 3) apply_trading_rules 4) search_trading_knowledge. Then decide.

RULES: No entry without stop. R/R < 2:1 → MONITOREAR. After hours/pre-market → NO_OPERAR. Rel vol < 3x → NO_OPERAR. NONE/WEAK catalyst → NO_OPERAR. Dilutive event → NO_OPERAR longs. STRONG catalyst → higher conviction. Spanish. Exact prices.

MANDATORY: estrategia_mas_probable and esperar_para_validar are REQUIRED for MONITOREAR and NO_OPERAR. Never use "N/A".
- If no setup forms (filters fail: price <$1, change <5%, etc): estrategia_mas_probable = "Ninguna — no cumple filtros mínimos" and esperar_para_validar = "Precio >$1, cambio >5%, volumen suficiente para reconsiderar" (o condiciones concretas que falten).
- If setup is forming but not ready: name the strategy (Bull Flag, ABCD, etc) and what to wait for.

OUTPUT: Only the JSON block, no preamble. Keep justificacion under 2 sentences. Keep alertas to 3 items max.
\`\`\`json
{
  "decision": "PREPARAR_ENTRADA|MONITOREAR|NO_OPERAR",
  "estrategia": "Bull Flag|ABCD|ORB|VWAP Reversal|null",
  "estrategia_mas_probable": "Strategy forming (required)",
  "esperar_para_validar": "Signals to wait for",
  "entry": 0.00,
  "stop": 0.00,
  "target_1": 0.00,
  "target_2": 0.00,
  "share_size": 0,
  "riesgo_total": 0.00,
  "ratio_rr": 0.0,
  "sesion": "THE_OPEN|LATE_MORNING|MIDDAY|THE_CLOSE|etc",
  "justificacion": "1-2 sentences, Spanish",
  "alertas": ["max 3 items"]
}
\`\`\``;
let AgentService = class AgentService {
    async analyze(req) {
        const { ticker, account_size = Number(process.env.DEFAULT_ACCOUNT_SIZE) || 25000, cutoff_ms } = req;
        const tStart = Date.now();
        this.logger.log(`[0.0s] Analyzing ${ticker} | account $${account_size}` + (cutoff_ms ? ` | SIMULATION up to ${new Date(cutoff_ms).toLocaleString('en-US', {
            timeZone: 'America/New_York'
        })} ET` : ''));
        const ragTool = (0, _ragtool.createRagTool)(this.ragService);
        const scannerTool = (0, _scannertool.createScannerTool)(this.scannerService, cutoff_ms);
        const rulesTool = (0, _rulestool.createRulesTool)();
        const newsTool = (0, _newstool.createNewsTool)();
        const tools = [
            ragTool,
            scannerTool,
            rulesTool,
            newsTool
        ];
        const toolsByName = {
            search_trading_knowledge: ragTool,
            get_stock_data: scannerTool,
            apply_trading_rules: rulesTool,
            analyze_news_catalyst: newsTool
        };
        const llmWithTools = this.llm.bindTools(tools);
        const messages = [
            new _messages.SystemMessage(SYSTEM_PROMPT),
            new _messages.HumanMessage(`Analyze ${ticker.toUpperCase()} for a trading opportunity. My account size is $${account_size.toLocaleString()}.`)
        ];
        let toolCallsCount = 0;
        let ragChunksUsed = 0;
        const MAX_ITERATIONS = 8;
        // Tool-calling loop (based on custom-agent-node/agent.js pattern)
        for(let i = 0; i < MAX_ITERATIONS; i++){
            const tLlm = Date.now();
            const response = await llmWithTools.invoke(messages);
            this.logger.log(`[${((Date.now() - tStart) / 1000).toFixed(1)}s] LLM call #${i + 1} took ${((Date.now() - tLlm) / 1000).toFixed(1)}s`);
            messages.push(response);
            // No more tool calls → done
            if (!response.tool_calls || response.tool_calls.length === 0) {
                this.logger.log(`[${((Date.now() - tStart) / 1000).toFixed(1)}s] Done. Total: ${toolCallsCount} tool calls.`);
                break;
            }
            // Execute each tool call
            for (const tc of response.tool_calls){
                toolCallsCount++;
                const tTool = Date.now();
                this.logger.log(`[${((Date.now() - tStart) / 1000).toFixed(1)}s] Tool [${toolCallsCount}]: ${tc.name} ...`);
                const toolFn = toolsByName[tc.name];
                if (!toolFn) {
                    messages.push(new _messages.ToolMessage({
                        tool_call_id: tc.id,
                        content: `Unknown tool: ${tc.name}`
                    }));
                    continue;
                }
                try {
                    const result = await toolFn.invoke(tc.args);
                    this.logger.log(`[${((Date.now() - tStart) / 1000).toFixed(1)}s] Tool ${tc.name} done in ${((Date.now() - tTool) / 1000).toFixed(1)}s`);
                    if (tc.name === 'search_trading_knowledge') ragChunksUsed++;
                    messages.push(new _messages.ToolMessage({
                        tool_call_id: tc.id,
                        content: typeof result === 'string' ? result : JSON.stringify(result)
                    }));
                } catch (err) {
                    this.logger.error(`Tool ${tc.name} error:`, err.message);
                    messages.push(new _messages.ToolMessage({
                        tool_call_id: tc.id,
                        content: `Tool error: ${err.message}`
                    }));
                }
            }
        }
        // Extract final AI message
        const finalMsg = messages.filter((m)=>m instanceof _messages.AIMessage && (!m.tool_calls || m.tool_calls.length === 0)).pop();
        const rawAnalysis = finalMsg?.content?.toString() || 'No analysis generated';
        // Parse structured JSON from the response
        const parsed = this.parseAgentResponse(rawAnalysis, ticker, account_size);
        this.logger.log(`[${((Date.now() - tStart) / 1000).toFixed(1)}s] ANALYSIS COMPLETE for ${ticker}`);
        const momentoEt = cutoff_ms ? new Date(cutoff_ms).toLocaleString('en-US', {
            timeZone: 'America/New_York',
            dateStyle: 'short',
            timeStyle: 'short'
        }) + ' ET' : new Date().toLocaleString('en-US', {
            timeZone: 'America/New_York',
            dateStyle: 'short',
            timeStyle: 'short'
        }) + ' ET';
        return {
            ...parsed,
            ticker: ticker.toUpperCase(),
            momento_analisis_et: momentoEt,
            rag_chunks_usados: ragChunksUsed,
            tool_calls_made: toolCallsCount,
            raw_analysis: rawAnalysis
        };
    }
    parseAgentResponse(raw, ticker, account_size) {
        try {
            const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/);
            if (jsonMatch) {
                const data = JSON.parse(jsonMatch[1]);
                return {
                    decision: data.decision || 'MONITOREAR',
                    estrategia: data.estrategia || null,
                    estrategia_mas_probable: data.estrategia_mas_probable || data.estrategia || null,
                    esperar_para_validar: data.esperar_para_validar || null,
                    entry: data.entry || null,
                    stop: data.stop || null,
                    target_1: data.target_1 || null,
                    target_2: data.target_2 || null,
                    share_size: data.share_size || null,
                    riesgo_total: data.riesgo_total || null,
                    ratio_rr: data.ratio_rr || null,
                    sesion: data.sesion || 'UNKNOWN',
                    justificacion: data.justificacion || raw,
                    alertas: data.alertas || []
                };
            }
        } catch  {
            this.logger.warn('Could not parse agent JSON response, returning raw text.');
        }
        // Fallback if JSON parsing fails
        return {
            decision: 'MONITOREAR',
            estrategia: null,
            estrategia_mas_probable: null,
            esperar_para_validar: null,
            entry: null,
            stop: null,
            target_1: null,
            target_2: null,
            share_size: null,
            riesgo_total: null,
            ratio_rr: null,
            sesion: 'UNKNOWN',
            justificacion: raw,
            alertas: [
                'Could not parse structured response — see raw_analysis'
            ]
        };
    }
    constructor(ragService, scannerService){
        this.ragService = ragService;
        this.scannerService = scannerService;
        this.logger = new _common.Logger(AgentService.name);
        this.llm = new _openai.ChatOpenAI({
            model: 'gpt-4o-mini',
            temperature: 0,
            apiKey: process.env.OPENAI_API_KEY
        });
    }
};
AgentService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _ragservice.RagService === "undefined" ? Object : _ragservice.RagService,
        typeof _scannerservice.ScannerService === "undefined" ? Object : _scannerservice.ScannerService
    ])
], AgentService);

//# sourceMappingURL=agent.service.js.map