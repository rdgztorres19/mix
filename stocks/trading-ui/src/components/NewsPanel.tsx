import type { CatalystAnalysis, NewsItem } from '../types';

interface Props {
  data: CatalystAnalysis;
}

const STRENGTH_CONFIG = {
  STRONG:   { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.3)',   label: '🟢 STRONG' },
  MODERATE: { color: '#eab308', bg: 'rgba(234,179,8,0.12)',   border: 'rgba(234,179,8,0.3)',   label: '🟡 MODERATE' },
  WEAK:     { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.3)',   label: '🔴 WEAK' },
  NONE:     { color: '#64748b', bg: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.3)', label: '⚪ NONE' },
};

function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}min ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / (60 * 24))}d ago`;
}

function ageColor(minutes: number): string {
  if (minutes < 60) return '#22c55e';
  if (minutes < 60 * 4) return '#eab308';
  return '#64748b';
}

export default function NewsPanel({ data }: Props) {
  const cfg = STRENGTH_CONFIG[data.catalyst_strength];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 20px 4px' }}>

      {/* ── Catalyst summary bar ── */}
      <div style={{
        display: 'flex',
        gap: 12,
        flexWrap: 'wrap',
        alignItems: 'center',
        padding: '14px 18px',
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 10,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: cfg.color, fontFamily: "'JetBrains Mono', monospace" }}>
              {cfg.label}
            </span>
            <span style={{
              fontSize: 12, color: '#94a3b8',
              background: '#1a2030', padding: '2px 10px', borderRadius: 20,
            }}>
              {data.catalyst_type}
            </span>
            {data.is_dilutive && (
              <span style={{
                fontSize: 12, fontWeight: 700, color: '#ef4444',
                background: 'rgba(239,68,68,0.15)', padding: '2px 10px', borderRadius: 20,
                border: '1px solid rgba(239,68,68,0.4)',
              }}>
                ⛔ DILUTIVE EVENT
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
            {data.trade_implication}
          </div>
        </div>

        {/* Confidence bar */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 60 }}>
          <span style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Confidence
          </span>
          <span style={{ fontSize: 18, fontWeight: 700, color: cfg.color, fontFamily: "'JetBrains Mono', monospace" }}>
            {(data.confidence * 100).toFixed(0)}%
          </span>
          <div style={{ width: 52, height: 4, background: '#1e293b', borderRadius: 2 }}>
            <div style={{
              width: `${data.confidence * 100}%`,
              height: '100%',
              background: cfg.color,
              borderRadius: 2,
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>

        {/* Justifies move badge */}
        <div style={{
          padding: '6px 14px',
          borderRadius: 8,
          background: data.justifies_move ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${data.justifies_move ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.2)'}`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
        }}>
          <span style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Justifies Move
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, color: data.justifies_move ? '#22c55e' : '#ef4444' }}>
            {data.justifies_move ? 'YES ✅' : 'NO ❌'}
          </span>
        </div>
      </div>

      {/* ── Headlines list ── */}
      <div>
        <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
          {data.headlines.length} headline{data.headlines.length !== 1 ? 's' : ''} encontrado{data.headlines.length !== 1 ? 's' : ''}
        </div>

        {data.headlines.length === 0 ? (
          <div style={{
            padding: '32px 20px',
            textAlign: 'center',
            color: '#475569',
            fontSize: 14,
            background: '#131820',
            borderRadius: 8,
            border: '1px dashed #232d3f',
          }}>
            No se encontraron noticias para este ticker
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.headlines.map((item, i) => (
              <HeadlineRow key={i} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HeadlineRow({ item }: { item: NewsItem }) {
  const age = item.age_minutes;
  const isRecent = age < 60 * 4;

  return (
    <div style={{
      display: 'flex',
      gap: 12,
      padding: '12px 14px',
      background: isRecent ? 'rgba(59,130,246,0.05)' : '#0f1520',
      border: `1px solid ${isRecent ? 'rgba(59,130,246,0.2)' : '#1e293b'}`,
      borderRadius: 8,
      alignItems: 'flex-start',
    }}>
      {/* Age badge */}
      <span style={{
        fontSize: 10,
        fontWeight: 600,
        color: ageColor(age),
        background: `${ageColor(age)}18`,
        padding: '3px 8px',
        borderRadius: 4,
        whiteSpace: 'nowrap',
        marginTop: 1,
        fontFamily: "'JetBrains Mono', monospace",
        minWidth: 60,
        textAlign: 'center',
      }}>
        {formatAge(age)}
      </span>

      {/* Title + publisher */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: '#e2e8f0',
              fontSize: 13,
              fontWeight: 500,
              textDecoration: 'none',
              lineHeight: 1.4,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#93c5fd')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#e2e8f0')}
          >
            {item.title}
          </a>
        ) : (
          <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500, lineHeight: 1.4 }}>
            {item.title}
          </span>
        )}
        <span style={{ fontSize: 11, color: '#475569' }}>{item.publisher}</span>
      </div>
    </div>
  );
}
