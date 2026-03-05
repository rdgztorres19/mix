import type { AnalyzeResponse } from '../types';

interface Props {
  data: AnalyzeResponse;
}

const DECISION_CONFIG = {
  PREPARAR_ENTRADA: { color: '#22c55e', bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.3)', label: '✅ PREPARAR ENTRADA' },
  MONITOREAR:       { color: '#eab308', bg: 'rgba(234,179,8,0.1)',  border: 'rgba(234,179,8,0.3)',  label: '👁️ MONITOREAR' },
  NO_OPERAR:        { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  border: 'rgba(239,68,68,0.3)',  label: '🚫 NO OPERAR' },
};

function Row({ label, value, color }: { label: string; value: string | number | null; color?: string }) {
  if (value === null || value === undefined) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #1a2030' }}>
      <span style={{ color: '#64748b', fontSize: 12 }}>{label}</span>
      <span style={{ color: color || '#e2e8f0', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}

export default function AnalysisPanel({ data }: Props) {
  const cfg = DECISION_CONFIG[data.decision];
  const rrColor = (data.ratio_rr ?? 0) >= 2 ? '#22c55e' : (data.ratio_rr ?? 0) >= 1.5 ? '#eab308' : '#ef4444';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Estrategia más probable + qué esperar (para MONITOREAR / NO_OPERAR) */}
      {(data.decision === 'MONITOREAR' || data.decision === 'NO_OPERAR') && (data.estrategia_mas_probable || data.esperar_para_validar) && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '14px 18px',
          background: 'rgba(59,130,246,0.06)',
          border: '1px solid rgba(59,130,246,0.25)',
          borderRadius: 10,
        }}>
          {data.estrategia_mas_probable && (
            <div>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                Estrategia más probable formándose
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#93c5fd', fontFamily: "'JetBrains Mono', monospace" }}>
                {data.estrategia_mas_probable}
              </div>
            </div>
          )}
          {data.esperar_para_validar && (
            <div>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                Esperar para validar
              </div>
              <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5 }}>
                {data.esperar_para_validar}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Decision badge */}
      <div style={{
        padding: '16px 20px',
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {data.momento_analisis_et && (
            <span style={{ background: '#1a2030', padding: '4px 10px', borderRadius: 6, fontSize: 11, color: '#94a3b8', fontFamily: "'JetBrains Mono', monospace" }}>
              🕐 {data.momento_analisis_et}
            </span>
          )}
          <span style={{ background: '#131820', padding: '4px 10px', borderRadius: 6, fontSize: 12, color: '#64748b' }}>
            {data.sesion}
          </span>
        </div>
      </div>

      {/* Trade levels */}
      {data.decision === 'PREPARAR_ENTRADA' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
          gap: 10,
        }}>
          {[
            { label: 'Estrategia', value: data.estrategia, color: '#38bdf8' },
            { label: 'Entry',      value: data.entry ? `$${data.entry.toFixed(2)}` : null,    color: '#22c55e' },
            { label: 'Stop',       value: data.stop  ? `$${data.stop.toFixed(2)}`  : null,    color: '#ef4444' },
            { label: 'Target 1',   value: data.target_1 ? `$${data.target_1.toFixed(2)}` : null, color: '#a78bfa' },
            { label: 'Target 2',   value: data.target_2 ? `$${data.target_2.toFixed(2)}` : null, color: '#a78bfa' },
            { label: 'Shares',     value: data.share_size, color: '#e2e8f0' },
            { label: 'Riesgo $',   value: data.riesgo_total ? `$${data.riesgo_total.toFixed(0)}` : null, color: '#ef4444' },
            { label: 'R/R',        value: data.ratio_rr ? `${data.ratio_rr.toFixed(1)}:1` : null, color: rrColor },
          ].map(({ label, value, color }) => value != null && (
            <div key={label} style={{
              padding: '10px 14px',
              background: '#1a2030',
              border: '1px solid #232d3f',
              borderRadius: 8,
            }}>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                {label}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace" }}>
                {value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Justification */}
      <div style={{ background: '#131820', border: '1px solid #232d3f', borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
          Análisis
        </div>
        <p style={{ color: '#cbd5e1', lineHeight: 1.7, fontSize: 13 }}>{data.justificacion}</p>
      </div>

      {/* Alerts */}
      {data.alertas?.length > 0 && (
        <div style={{ background: '#131820', border: '1px solid #232d3f', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
            Alertas / Condiciones
          </div>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.alertas.map((a, i) => (
              <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: '#fbbf24', fontSize: 13 }}>
                <span style={{ color: '#f97316', flexShrink: 0 }}>›</span>
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Meta */}
      <div style={{ fontSize: 11, color: '#334155', textAlign: 'right' }}>
        {data.tool_calls_made} tool calls · {data.rag_chunks_usados} RAG chunks
      </div>
    </div>
  );
}
