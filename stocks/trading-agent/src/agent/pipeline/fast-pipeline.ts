import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { RagService } from '../../rag/rag.service';
import { ScannerService } from '../../scanner/scanner.service';
import { AnalysisLogService } from '../../analysis-log/analysis-log.service';
import { NewsCacheService } from '../../cache/news-cache.service';
import { applyTradingRules } from '../../small-cap-trading';
import { fetchYahooNews, fetchFinvizNews, scoreHeadlines } from '../tools/news.tool';
import { formatStockSnapshotForLLM, getSession } from '../tools/scanner.tool';
import { SYSTEM_PROMPT } from './prompts';
import type { AnalyzeRequest, AnalyzeResponse } from './analysis.types';
import { AnalysisResponseBuilder } from './analysis-response.builder';
import type { StockSnapshot } from '../../scanner/scanner.service';

/**
 * Fast deterministic pipeline:
 * 1. Fetch stock + news in parallel
 * 2. Score catalyst (cache or LLM) → early exit if dilutive
 * 3. applyTradingRules → early exit if hard stops
 * 4. Early exit if catalyst NONE/WEAK
 * 5. RAG search
 * 6. Single LLM call (only for qualified setups)
 *
 * Most requests resolve in ~2-3s without LLM.
 */
@Injectable()
export class FastPipeline {
  private readonly logger = new Logger(FastPipeline.name);

  constructor(
    private readonly scannerService: ScannerService,
    private readonly newsCache: NewsCacheService,
    private readonly ragService: RagService,
    private readonly analysisLog: AnalysisLogService,
    private readonly responseBuilder: AnalysisResponseBuilder,
    private readonly llm: ChatOpenAI,
  ) {}

  async run(req: AnalyzeRequest): Promise<AnalyzeResponse> {
    const { ticker, account_size = Number(process.env.DEFAULT_ACCOUNT_SIZE) || 25000, timeframe = '5m', cutoff_ms } = req;
    const tickerUpper = ticker.toUpperCase();
    const tStart = Date.now();
    const elapsed = () => `[${((Date.now() - tStart) / 1000).toFixed(1)}s]`;

    const [snap, cachedCatalyst, rawHeadlines] = await Promise.all([
      this.scannerService.getStockSnapshot(tickerUpper, cutoff_ms, timeframe),
      this.newsCache.get(tickerUpper),
      fetchYahooNews(tickerUpper).then((h) => (h.length ? h : fetchFinvizNews(tickerUpper))),
    ]);
    this.logger.log(`${elapsed()} [FAST] stock + news fetched (cache=${cachedCatalyst ? 'HIT' : 'MISS'})`);

    const session = this.getSession(cutoff_ms);
    const momentoEt = this.formatMomentoEt(cutoff_ms);

    const { catalyst, headlinesForDisplay } = await this.resolveCatalyst(cachedCatalyst, rawHeadlines, tickerUpper, elapsed);

    if (catalyst.is_dilutive) {
      this.logger.log(`${elapsed()} [FAST] EXIT — dilutive event, skipping LLM`);
      return this.earlyExitNoTrade({
        tickerUpper,
        session,
        momentoEt,
        account_size,
        cutoff_ms,
        tStart,
        reason: `Evento dilutivo detectado: ${catalyst.catalyst_type}`,
        alertas: ['Dilución confirmada — evitar longs', 'Posible setup short en rebote a VWAP', catalyst.catalyst_type],
        estrategia_mas_probable: 'Posible short en oferta/dilución',
        esperar_para_validar: 'Esperar rechazo de VWAP o EMA para posición short',
      });
    }

    const rules = this.applyRules(snap, session, timeframe, account_size, tickerUpper);
    this.logger.log(`${elapsed()} [FAST] rules viable=${rules.viable} strategy=${rules.identified_strategy ?? 'none'}`);

    if (!rules.viable) {
      this.logger.log(`${elapsed()} [FAST] EXIT — hard stops triggered, skipping LLM`);
      return this.earlyExitNoTrade({
        tickerUpper,
        session,
        momentoEt,
        account_size,
        cutoff_ms,
        tStart,
        reason: rules.hard_stops.slice(0, 3).join(' | '),
        alertas: rules.hard_stops.slice(0, 3),
        estrategia_mas_probable: 'Ninguna — no cumple filtros mínimos',
        esperar_para_validar: 'Precio >$1, cambio >5%, rel vol >3x, ATR >$0.30 para reconsiderar',
      });
    }

    if (catalyst.strength === 'NONE' || catalyst.strength === 'WEAK') {
      this.logger.log(`${elapsed()} [FAST] EXIT — catalyst ${catalyst.strength}, skipping LLM`);
      const strat = rules.identified_strategy ?? 'setup técnico sin catalizador';
      return this.earlyExitNoTrade({
        tickerUpper,
        session,
        momentoEt,
        account_size,
        cutoff_ms,
        tStart,
        reason: `Catalizador insuficiente (${catalyst.strength}): ${catalyst.catalyst_type}`,
        alertas: [
          `Catalizador: ${catalyst.catalyst_type}`,
          'Movimiento sin fundamento — alta probabilidad de reversal',
          'Esperar noticia STRONG para operar con convicción',
        ],
        estrategia_mas_probable: strat,
        esperar_para_validar: `Noticia STRONG + confirmación de ${strat} con volumen`,
        entry: rules.entry_zone?.price ?? null,
        stop: rules.stop_loss?.price ?? null,
        target_1: rules.target_1?.price ?? null,
        target_2: rules.target_2?.price ?? null,
        share_size: rules.share_size,
        riesgo_total: rules.risk_amount,
        ratio_rr: rules.rr_ratio,
        estrategia: rules.identified_strategy ?? null,
      });
    }

    const ragResult = await this.fetchRag(rules.identified_strategy, elapsed);

    return this.runLlmAndRespond({
      snap,
      rules,
      catalyst,
      headlinesForDisplay,
      ragResult,
      tickerUpper,
      account_size,
      timeframe,
      cutoff_ms,
      session,
      momentoEt,
      tStart,
      elapsed,
    });
  }

  private getSession(cutoffMs?: number): string {
    const refDate = cutoffMs ? new Date(cutoffMs) : new Date();
    const etTime = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(refDate);
    return getSession(etTime);
  }

  private formatMomentoEt(cutoffMs?: number): string {
    return (
      new Date(cutoffMs ?? Date.now()).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        dateStyle: 'short',
        timeStyle: 'short',
      }) + ' ET'
    );
  }

  private async resolveCatalyst(
    cached: Awaited<ReturnType<NewsCacheService['get']>>,
    rawHeadlines: Awaited<ReturnType<typeof fetchYahooNews>>,
    tickerUpper: string,
    elapsed: () => string,
  ) {
    if (cached) {
      this.logger.log(`${elapsed()} [FAST] catalyst from cache: ${cached.strength}`);
      return {
        catalyst: {
          strength: cached.strength,
          catalyst_type: cached.catalyst_type,
          is_dilutive: cached.is_dilutive,
          justifies_move: cached.justifies_move,
        },
        headlinesForDisplay: cached.headlines_sample.map((title) => ({
          title,
          publisher: 'cached',
          published_at: new Date(cached.cached_at).toISOString(),
          url: '',
          age_minutes: Math.round((Date.now() - cached.cached_at) / 60000),
        })),
      };
    }
    const catalyst = await scoreHeadlines(rawHeadlines);
    this.logger.log(`${elapsed()} [FAST] catalyst=${catalyst.strength} dilutive=${catalyst.is_dilutive}`);
    await this.newsCache.set(tickerUpper, {
      strength: catalyst.strength,
      catalyst_type: catalyst.catalyst_type,
      is_dilutive: catalyst.is_dilutive,
      justifies_move: catalyst.justifies_move,
      headlines_sample: rawHeadlines.slice(0, 5).map((h) => h.title),
    });
    return { catalyst, headlinesForDisplay: rawHeadlines };
  }

  private applyRules(
    snap: StockSnapshot,
    session: string,
    timeframe: '1m' | '5m',
    account_size: number,
    tickerUpper: string,
  ) {
    const candles = (timeframe === '1m' ? snap.candles_1min : snap.candles_5min).slice(-5);
    return applyTradingRules({
      ticker: tickerUpper,
      price: snap.price,
      vwap: snap.vwap,
      ema9: snap.ema9,
      ema20: snap.ema20,
      relative_volume: snap.relative_volume,
      change_pct: snap.change_pct,
      atr: snap.atr,
      session,
      pre_market_high: snap.pre_market_high,
      account_size,
      last_candles_json: candles.length ? JSON.stringify(candles) : undefined,
    });
  }

  private async fetchRag(identifiedStrategy: string | null, elapsed: () => string): Promise<string> {
    try {
      if (identifiedStrategy) {
        const results = await this.ragService.searchByStrategy(
          `${identifiedStrategy} entry rules stop loss setup`,
          identifiedStrategy as any,
          3,
        );
        return this.ragService.formatResultsForLLM(results);
      }
      const results = await this.ragService.searchGeneral('day trading risk management momentum', 3);
      return this.ragService.formatResultsForLLM(results);
    } catch {
      return 'No RAG results.';
    } finally {
      this.logger.log(`${elapsed()} [FAST] RAG done`);
    }
  }

  private earlyExitNoTrade(params: {
    tickerUpper: string;
    session: string;
    momentoEt: string;
    account_size: number;
    cutoff_ms?: number;
    tStart: number;
    reason: string;
    alertas: string[];
    estrategia_mas_probable: string;
    esperar_para_validar: string;
    entry?: number | null;
    stop?: number | null;
    target_1?: number | null;
    target_2?: number | null;
    share_size?: number | null;
    riesgo_total?: number | null;
    ratio_rr?: number | null;
    estrategia?: string | null;
  }): AnalyzeResponse {
    const { tStart, account_size, cutoff_ms, ...rest } = params;
    const durationMs = Date.now() - tStart;
    this.logger.log(`[${(durationMs / 1000).toFixed(1)}s] ANALYSIS COMPLETE for ${params.tickerUpper} (early exit, no LLM)`);

    const result = this.responseBuilder.buildNoTrade({
      ...rest,
      account_size,
      cutoff_ms,
      tool_calls_made: 2,
    });

    this.analysisLog.insert({
      ticker: params.tickerUpper,
      account_size,
      cutoff_ms: cutoff_ms ?? null,
      request_prompt: `Analyze ${params.tickerUpper} (fast path early exit)`,
      messages_json: '[]',
      response_json: JSON.stringify(result),
      raw_analysis: result.raw_analysis,
      tool_calls_count: 2,
      rag_chunks_used: 0,
      duration_ms: durationMs,
    });

    return result;
  }

  private async runLlmAndRespond(params: {
    snap: StockSnapshot;
    rules: ReturnType<typeof applyTradingRules>;
    catalyst: Awaited<ReturnType<typeof scoreHeadlines>>;
    headlinesForDisplay: Array<{ title: string; publisher: string; age_minutes?: number }>;
    ragResult: string;
    tickerUpper: string;
    account_size: number;
    timeframe: '1m' | '5m';
    cutoff_ms?: number;
    session: string;
    momentoEt: string;
    tStart: number;
    elapsed: () => string;
  }): Promise<AnalyzeResponse> {
    const {
      snap,
      rules,
      catalyst,
      headlinesForDisplay,
      ragResult,
      tickerUpper,
      account_size,
      timeframe,
      cutoff_ms,
      session,
      momentoEt,
      tStart,
      elapsed,
    } = params;

    const stockText = formatStockSnapshotForLLM(snap, tickerUpper, timeframe, cutoff_ms);
    const newsText = headlinesForDisplay
      .slice(0, 6)
      .map((h) => {
        const age = (h.age_minutes ?? 0) < 60 ? `${h.age_minutes ?? 0}min ago` : `${Math.floor((h.age_minutes ?? 0) / 60)}h ago`;
        return `[${age}] ${h.title} — ${h.publisher}`;
      })
      .join('\n');
    const catalystText = `Catalyst: ${catalyst.strength} | Type: ${catalyst.catalyst_type} | Dilutive: ${catalyst.is_dilutive}`;
    const rulesText = [
      `Strategy: ${rules.identified_strategy}`,
      `Signals: ${rules.pattern_signals.join(', ')}`,
      `Entry: $${rules.entry_zone?.price.toFixed(2)} | Stop: $${rules.stop_loss?.price.toFixed(2)}`,
      `T1: $${rules.target_1?.price.toFixed(2)} | T2: $${rules.target_2?.price.toFixed(2)}`,
      `R/R: ${rules.rr_ratio?.toFixed(1)}:1 | Shares: ${rules.share_size} | Risk: $${rules.risk_amount?.toFixed(0)}`,
    ].join('\n');

    const contextPrompt = `All data is pre-fetched. Follow the 5-phase reasoning in the system prompt.

<STOCK_DATA>
${stockText}
</STOCK_DATA>

<NEWS_CATALYST>
${catalystText}
Headlines:
${newsText}
</NEWS_CATALYST>

<DETERMINISTIC_RULES_OUTPUT>
${rulesText}
</DETERMINISTIC_RULES_OUTPUT>

<KNOWLEDGE_BASE>
${ragResult}
</KNOWLEDGE_BASE>`;

    const tLlm = Date.now();
    const llmResponse = await this.llm.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(`Analyze ${tickerUpper}. Account: $${account_size.toLocaleString()}.\n\n${contextPrompt}`),
    ]);
    this.logger.log(`${elapsed()} [FAST] LLM call took ${((Date.now() - tLlm) / 1000).toFixed(1)}s`);

    const rawAnalysis = llmResponse.content?.toString() || 'No analysis generated';
    const parsed = this.responseBuilder.parse(rawAnalysis, tickerUpper, account_size);
    const durationMs = Date.now() - tStart;
    this.logger.log(`${elapsed()} ANALYSIS COMPLETE for ${tickerUpper} (fast path + LLM)`);

    const result: AnalyzeResponse = {
      ...parsed,
      ticker: tickerUpper,
      momento_analisis_et: momentoEt,
      rag_chunks_usados: 1,
      tool_calls_made: 4,
      raw_analysis: rawAnalysis,
    };

    this.analysisLog.insert({
      ticker: tickerUpper,
      account_size,
      cutoff_ms: cutoff_ms ?? null,
      request_prompt: `Analyze ${tickerUpper} (fast path)`,
      messages_json: '[]',
      response_json: JSON.stringify(result),
      raw_analysis: rawAnalysis,
      tool_calls_count: 4,
      rag_chunks_used: 1,
      duration_ms: durationMs,
    });

    return result;
  }
}
