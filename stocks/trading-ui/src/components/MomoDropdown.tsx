import type { MomoStock } from '../types';

interface Props {
  stocks: MomoStock[];
  loading: boolean;
  filter: string;
  onSelect: (symbol: string) => void;
}

const fmtVol = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
};

const fmtFloat = (n: number | null) => {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M float`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K float`;
  return null;
};

export default function MomoDropdown({ stocks, loading, filter, onSelect }: Props) {
  const filtered = filter
    ? stocks.filter((s) => s.symbol.startsWith(filter.toUpperCase()))
    : stocks;

  if (!loading && filtered.length === 0) return null;

  return (
    <div style={{
      position: 'absolute',
      top: 'calc(100% + 6px)',
      left: 0,
      right: 0,
      background: '#0f1520',
      border: '1px solid #2d3f55',
      borderRadius: 10,
      zIndex: 100,
      maxHeight: 420,
      overflowY: 'auto',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 14px',
        borderBottom: '1px solid #1e293b',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 11, color: '#475569', fontFamily: "'JetBrains Mono', monospace" }}>
          TOP MOVERS · momoscreener
        </span>
        {loading && (
          <span style={{ fontSize: 11, color: '#475569' }}>cargando…</span>
        )}
        {!loading && (
          <span style={{ fontSize: 11, color: '#334155' }}>{filtered.length} stocks</span>
        )}
      </div>

      {/* Rows */}
      {filtered.map((s) => (
        <button
          key={s.symbol}
          onMouseDown={(e) => { e.preventDefault(); onSelect(s.symbol); }}
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            borderBottom: '1px solid #131820',
            padding: '10px 14px',
            cursor: 'pointer',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            transition: 'background 0.1s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#1a2030')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          {/* Symbol + price */}
          <div style={{ minWidth: 80 }}>
            <div style={{
              fontWeight: 700,
              fontSize: 14,
              color: '#e2e8f0',
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: '0.03em',
            }}>
              {s.symbol}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', fontFamily: "'JetBrains Mono', monospace" }}>
              ${s.price.toFixed(2)}
            </div>
          </div>

          {/* Change badges */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 72 }}>
            <span style={{
              fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
              color: s.change >= 0 ? '#22c55e' : '#ef4444',
            }}>
              {s.change >= 0 ? '+' : ''}{s.change.toFixed(1)}%
            </span>
            <span style={{
              fontSize: 10, color: '#475569',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              5m: {s.change5m >= 0 ? '+' : ''}{s.change5m.toFixed(1)}%
            </span>
          </div>

          {/* Volume + float */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 72 }}>
            <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: "'JetBrains Mono', monospace" }}>
              {fmtVol(s.volume)}
            </span>
            {fmtFloat(s.float) && (
              <span style={{ fontSize: 10, color: '#334155', fontFamily: "'JetBrains Mono', monospace" }}>
                {fmtFloat(s.float)}
              </span>
            )}
          </div>

          {/* Headline */}
          {s.headline && (
            <div style={{
              flex: 1,
              fontSize: 11,
              color: '#475569',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              lineHeight: 1.4,
            }}>
              {s.headline}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
