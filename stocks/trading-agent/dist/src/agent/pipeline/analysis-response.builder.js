"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalysisResponseBuilder = void 0;
const common_1 = require("@nestjs/common");
class AnalysisResponseBuilder {
    constructor() {
        this.logger = new common_1.Logger(AnalysisResponseBuilder.name);
    }
    parse(raw, ticker, _accountSize) {
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
                    alertas: data.alertas || [],
                };
            }
        }
        catch {
            this.logger.warn('Could not parse agent JSON response, returning raw text.');
        }
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
            alertas: ['Could not parse structured response — see raw_analysis'],
        };
    }
    buildNoTrade(params) {
        const { tickerUpper, session, momentoEt, reason, alertas, estrategia_mas_probable, esperar_para_validar, entry = null, stop = null, target_1 = null, target_2 = null, share_size = null, riesgo_total = null, ratio_rr = null, estrategia = null, tool_calls_made, } = params;
        return {
            ticker: tickerUpper,
            decision: 'NO_OPERAR',
            momento_analisis_et: momentoEt,
            estrategia,
            estrategia_mas_probable,
            esperar_para_validar,
            entry,
            stop,
            target_1,
            target_2,
            share_size,
            riesgo_total,
            ratio_rr,
            sesion: session,
            justificacion: reason,
            alertas: alertas.slice(0, 3),
            rag_chunks_usados: 0,
            tool_calls_made,
            raw_analysis: `NO_OPERAR — ${reason}`,
        };
    }
}
exports.AnalysisResponseBuilder = AnalysisResponseBuilder;
//# sourceMappingURL=analysis-response.builder.js.map