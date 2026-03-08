import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { RagService } from '../../rag/rag.service';
import { ScannerService } from '../../scanner/scanner.service';
import { AnalysisLogService } from '../../analysis-log/analysis-log.service';
import { createRagTool } from '../tools/rag.tool';
import { createScannerTool } from '../tools/scanner.tool';
import { createRulesTool } from '../tools/rules.tool';
import { createNewsTool } from '../tools/news.tool';
import { createPythonTool } from '../tools/python.tool';
import { SYSTEM_PROMPT } from './prompts';
import type { AnalyzeRequest, AnalyzeResponse } from './analysis.types';
import { AnalysisResponseBuilder } from './analysis-response.builder';

const MAX_ITERATIONS = 8;
const LLM_TIMEOUT_MS = 120_000;

/**
 * Agentic pipeline: LLM decides which tools to call in a loop.
 * Slower but more flexible — suitable when structure is unclear.
 */
@Injectable()
export class AgenticPipeline {
  private readonly logger = new Logger(AgenticPipeline.name);

  constructor(
    private readonly ragService: RagService,
    private readonly scannerService: ScannerService,
    private readonly analysisLog: AnalysisLogService,
    private readonly responseBuilder: AnalysisResponseBuilder,
    private readonly llm: ChatOpenAI,
  ) {}

  async run(req: AnalyzeRequest): Promise<AnalyzeResponse> {
    const { ticker, account_size = Number(process.env.DEFAULT_ACCOUNT_SIZE) || 25000, cutoff_ms } = req;
    const tStart = Date.now();

    const ragTool = createRagTool(this.ragService);
    const scannerTool = createScannerTool(this.scannerService, cutoff_ms, req.timeframe ?? '5m');
    const rulesTool = createRulesTool();
    const newsTool = createNewsTool();
    const pythonTool = createPythonTool();
    const tools = [ragTool, scannerTool, rulesTool, newsTool, pythonTool];
    const toolsByName: Record<string, any> = {
      search_trading_knowledge: ragTool,
      get_stock_data: scannerTool,
      apply_trading_rules: rulesTool,
      analyze_news_catalyst: newsTool,
      run_python: pythonTool,
    };

    const llmWithTools = this.llm.bindTools(tools);
    const messages: any[] = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(
        `Analyze ${ticker.toUpperCase()} for a trading opportunity. My account size is $${account_size.toLocaleString()}.`,
      ),
    ];

    let toolCallsCount = 0;
    let ragChunksUsed = 0;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const tLlm = Date.now();
      const response = await llmWithTools.invoke(messages, { timeout: LLM_TIMEOUT_MS });
      this.logger.log(`[${((Date.now() - tStart) / 1000).toFixed(1)}s] LLM call #${i + 1} took ${((Date.now() - tLlm) / 1000).toFixed(1)}s`);
      messages.push(response);

      if (!response.tool_calls || response.tool_calls.length === 0) {
        this.logger.log(`[${((Date.now() - tStart) / 1000).toFixed(1)}s] Done. Total: ${toolCallsCount} tool calls.`);
        break;
      }

      const tTools = Date.now();
      const toolResults = await Promise.all(
        response.tool_calls.map(async (tc: any) => {
          const toolFn = toolsByName[tc.name];
          if (!toolFn) {
            return { tc, content: `Unknown tool: ${tc.name}`, ragUsed: false };
          }
          try {
            const result = await toolFn.invoke(tc.args);
            return {
              tc,
              content: typeof result === 'string' ? result : JSON.stringify(result),
              ragUsed: tc.name === 'search_trading_knowledge',
            };
          } catch (err: any) {
            this.logger.error(`Tool ${tc.name} error:`, err.message);
            return { tc, content: `Tool error: ${err.message}`, ragUsed: false };
          }
        }),
      );
      this.logger.log(`[${((Date.now() - tStart) / 1000).toFixed(1)}s] Tools done in ${((Date.now() - tTools) / 1000).toFixed(1)}s (parallel)`);

      for (const { tc, content, ragUsed } of toolResults) {
        toolCallsCount++;
        this.logger.log(`[${((Date.now() - tStart) / 1000).toFixed(1)}s] Tool [${toolCallsCount}]: ${tc.name} ✓`);
        if (ragUsed) ragChunksUsed++;
        messages.push(new ToolMessage({ tool_call_id: tc.id, content }));
      }
    }

    const finalMsg = messages
      .filter((m: any) => m instanceof AIMessage && (!m.tool_calls || m.tool_calls.length === 0))
      .pop();
    const rawAnalysis = finalMsg?.content?.toString() || 'No analysis generated';
    const parsed = this.responseBuilder.parse(rawAnalysis, ticker, account_size);

    const durationMs = Date.now() - tStart;
    const momentoEt = cutoff_ms
      ? new Date(cutoff_ms).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' }) + ' ET'
      : new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' }) + ' ET';

    const result: AnalyzeResponse = {
      ...parsed,
      ticker: ticker.toUpperCase(),
      momento_analisis_et: momentoEt,
      rag_chunks_usados: ragChunksUsed,
      tool_calls_made: toolCallsCount,
      raw_analysis: rawAnalysis,
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
      duration_ms: durationMs,
    });

    this.logger.log(`[${(durationMs / 1000).toFixed(1)}s] ANALYSIS COMPLETE for ${ticker}`);
    return result;
  }

  private serializeMessages(messages: any[]): any[] {
    return messages.map((m) => {
      const type = (m.constructor?.name ?? 'unknown').replace('Message', '').toLowerCase();
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      const obj: any = { type, content: content.slice(0, 100_000) };
      if (m.tool_calls?.length) obj.tool_calls = m.tool_calls;
      if (m.tool_call_id) obj.tool_call_id = m.tool_call_id;
      return obj;
    });
  }
}
