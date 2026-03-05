/** Guía rápida de estrategias extraída del knowledge base. */

export const STRATEGY_GUIDE = {
  filters: {
    title: 'Filtros mínimos (Stock in Play)',
    items: [
      'Precio: $2–$20 ideal',
      'Cambio: ≥10% vs cierre anterior',
      'Volumen relativo: ≥5x promedio',
      'Catalizador: noticias o breakout técnico diario',
      'Float: <20M para movimientos mayores',
    ],
  },
  sessions: {
    title: 'Sesiones y mejores estrategias',
    items: [
      { session: 'The Open (9:30–10:30)', strategies: 'Bull Flag, ORB, ABCD, VWAP Reversal, Fallen Angel' },
      { session: 'Late Morning (10:30–12:00)', strategies: 'VWAP Reversal, VWAP False Breakout' },
      { session: 'Midday (12:00–15:00)', strategies: 'VWAP Moving Average Trend, VWAP False Breakout' },
      { session: 'The Close (15:00–16:00)', strategies: 'VWAP Moving Average Trend' },
    ],
  },
  strategies: [
    {
      name: 'Bull Flag',
      entry: 'Primera vela que rompe el high de la consolidación. Ideal: 1m y 5m hacen new high al mismo tiempo.',
      exit: 'Parcial en break de HOD; stop a breakeven. Resto en target o cuando pierde steam.',
      stop: 'Low del último candle de consolidación.',
      confirm: '3+ velas verdes subiendo → 2+ rojas/sideways → break arriba con volumen fuerte. Pullback a EMA9.',
    },
    {
      name: 'ABCD',
      entry: 'En Point C (soporte), cuando precio mantiene y vuelve a subir. Entrada en break de Point B.',
      exit: 'Parcial en Point D; stop a breakeven. Resto cuando alcanza target o nuevo low 5m (agotamiento).',
      stop: 'Debajo de Point C. Si consolidó en VWAP, debajo de VWAP.',
      confirm: 'A→B subida fuerte; B→C pullback; C→D break con volumen. 1m y 5m para confirmar.',
    },
    {
      name: 'Opening Range Breakout (ORB)',
      entry: 'Break del rango de los primeros 5 min. Long si rompe arriba; short si rompe abajo.',
      exit: 'Target: siguiente nivel técnico (PCL, Y-high/low, EMAs diarias). Debilidad: new low 5m (long) o new high (short).',
      stop: 'Long: cierre debajo VWAP. Short: cierre arriba VWAP.',
      confirm: 'Rango inicial < ATR. Volumen con muchas órdenes diferentes (no solo pocos bloques grandes).',
    },
    {
      name: 'VWAP Reversal',
      entry: 'Cuando precio bajo VWAP deja de hacer new low 5m → señal squeeze. O precio arriba VWAP falla new high.',
      exit: 'Target: VWAP, EMA9, EMA20, 50 SMA. Parcial en VWAP, stop a breakeven.',
      stop: 'Debajo low del día (long) o arriba high del día (short).',
      confirm: 'Failure to make new 5-min low (below VWAP) o new high (above VWAP). Patrón HH/HL o LH/HL.',
    },
    {
      name: 'VWAP False Breakout',
      entry: 'Stock fuerte arriba VWAP pierde VWAP en Late Morning → short. O débil debajo rompe arriba → long (squeeze).',
      exit: 'Target: low del día o siguiente nivel diario.',
      stop: 'Arriba VWAP (para shorts).',
      confirm: 'Pierde VWAP después de haberla sostenido. Típico 10:30–12:00.',
    },
    {
      name: 'Fallen Angel',
      entry: 'Nuevo high 1m o 5m después de consolidación, con volumen masivo vs velas anteriores.',
      exit: 'Targets: VWAP, HOD, PM high, Y-high/low.',
      stop: 'Debajo de la consolidación.',
      confirm: 'Gap up pre-market, vende al open, consolida en soporte. Volumen clave. Evitar primer uptick del open.',
    },
  ],
  rules: {
    title: 'Reglas mínimas',
    items: [
      'Riesgo por trade: ≤2% cuenta. R/R mínimo 2:1.',
      'Siempre stop loss definido antes de entrar.',
      'Sin volumen relativo alto, olvidar el patrón.',
      'Evitar acciones <$1. Cambio <5% = no operar.',
      'Catalizador NONE o WEAK → NO_OPERAR o tamaño pequeño.',
      'Evento dilutivo (offering) → NO_OPERAR longs.',
    ],
  },
};

interface Props {
  onClose: () => void;
}

export default function StrategyGuide({ onClose }: Props) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: '#0f1520',
          border: '1px solid #2d3f55',
          borderRadius: 12,
          maxWidth: 640,
          maxHeight: '90vh',
          overflowY: 'auto',
          width: '100%',
          boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid #232d3f',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>📋 Guía de Estrategias</span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              fontSize: 20,
              cursor: 'pointer',
              padding: '0 8px',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 20 }}>
          <Section title={STRATEGY_GUIDE.filters.title}>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {STRATEGY_GUIDE.filters.items.map((item, i) => (
                <li key={i} style={{ marginBottom: 6, color: '#cbd5e1', fontSize: 13 }}>{item}</li>
              ))}
            </ul>
          </Section>

          <Section title={STRATEGY_GUIDE.sessions.title}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {STRATEGY_GUIDE.sessions.items.map((s, i) => (
                <div key={i} style={{
                  padding: '10px 14px',
                  background: '#1a2030',
                  borderRadius: 8,
                  border: '1px solid #232d3f',
                }}>
                  <div style={{ fontWeight: 600, color: '#93c5fd', fontSize: 13 }}>{s.session}</div>
                  <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>{s.strategies}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Estrategias: Entrada · Salida · Confirmación">
            {STRATEGY_GUIDE.strategies.map((s, i) => (
              <div key={i} style={{
                padding: 14,
                background: '#1a2030',
                borderRadius: 10,
                border: '1px solid #232d3f',
                marginBottom: 12,
              }}>
                <div style={{ fontWeight: 700, color: '#38bdf8', fontSize: 15, marginBottom: 10 }}>{s.name}</div>
                <Row label="Entrada" value={s.entry} />
                <Row label="Stop" value={s.stop} />
                <Row label="Salida" value={s.exit} />
                <Row label="Confirmación" value={s.confirm} />
              </div>
            ))}
          </Section>

          <Section title={STRATEGY_GUIDE.rules.title}>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {STRATEGY_GUIDE.rules.items.map((item, i) => (
                <li key={i} style={{ marginBottom: 6, color: '#fbbf24', fontSize: 13 }}>{item}</li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontSize: 11,
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: 10,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <span style={{ color: '#64748b', fontSize: 11, fontWeight: 600 }}>{label}: </span>
      <span style={{ color: '#cbd5e1', fontSize: 12 }}>{value}</span>
    </div>
  );
}
