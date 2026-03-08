import type { StrategyGuidance, StrategySnapshot } from '../types';

interface Props {
  strategy: StrategySnapshot;
}

export default function StrategyInfoPanel({ strategy }: Props) {
  const guidance = strategy.strategy_guidance;
  if (!guidance && !strategy.name) return null;

  return (
    <div style={{
      background: '#131820',
      border: '1px solid #232d3f',
      borderRadius: 12,
      padding: 20,
    }}>
      {/* Strategy header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 16,
      }}>
        <span style={{ fontSize: 18 }}>📐</span>
        <span style={{
          fontSize: 16,
          fontWeight: 700,
          color: strategy.viable ? '#4ade80' : '#eab308',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {strategy.name}
        </span>
        <span style={{
          padding: '2px 8px',
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 600,
          background: strategy.viable ? 'rgba(34,197,94,0.15)' : 'rgba(234,179,8,0.15)',
          color: strategy.viable ? '#4ade80' : '#eab308',
          border: `1px solid ${strategy.viable ? 'rgba(34,197,94,0.3)' : 'rgba(234,179,8,0.3)'}`,
        }}>
          {strategy.viable ? 'VIABLE' : 'NOT VIABLE'}
        </span>
      </div>

      {/* Trade levels grid */}
      {(strategy.entry || strategy.stop || strategy.target_1) && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
          marginBottom: 16,
        }}>
          <LevelBox label="Entry" value={strategy.entry} color="#22c55e" />
          <LevelBox label="Stop" value={strategy.stop} color="#ef4444" />
          <LevelBox label="T1" value={strategy.target_1} color="#a78bfa" />
          <LevelBox label="T2" value={strategy.target_2} color="#a78bfa" />
        </div>
      )}

      {/* Guidance sections */}
      {guidance && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <GuidanceSection
            title="Qué observar"
            content={guidance.what_to_watch}
            icon="👁️"
          />
          <GuidanceSection
            title="Señales de confirmación"
            icon="✅"
          >
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {guidance.confirmation_signals.map((s, i) => (
                <li key={i} style={{ color: '#cbd5e1', fontSize: 12 }}>{s}</li>
              ))}
            </ul>
          </GuidanceSection>
          <GuidanceSection
            title="Invalidación"
            content={guidance.invalidation}
            icon="🚫"
            color="#ef4444"
          />
          <GuidanceSection
            title="Contexto de sesión"
            content={guidance.session_context}
            icon="🕐"
          />
        </div>
      )}

      {/* Pattern signals */}
      {strategy.pattern_signals.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{
            fontSize: 10,
            color: '#64748b',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: 8,
          }}>
            Señales del patrón
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {strategy.pattern_signals.map((s, i) => (
              <span key={i} style={{
                padding: '3px 10px',
                background: '#1a2030',
                border: '1px solid #232d3f',
                borderRadius: 6,
                fontSize: 11,
                color: '#94a3b8',
              }}>
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LevelBox({ label, value, color }: { label: string; value: number | null; color: string }) {
  if (value == null) return <div />;
  return (
    <div style={{
      padding: '8px 12px',
      background: '#1a2030',
      border: '1px solid #232d3f',
      borderRadius: 8,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace" }}>
        ${value.toFixed(2)}
      </div>
    </div>
  );
}

function GuidanceSection({ title, content, icon, color, children }: {
  title: string;
  content?: string;
  icon: string;
  color?: string;
  children?: React.ReactNode;
}) {
  return (
    <div style={{
      padding: '10px 14px',
      background: '#0f1520',
      border: '1px solid #1e293b',
      borderRadius: 8,
    }}>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        color: '#64748b',
        marginBottom: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <span>{icon}</span>
        {title}
      </div>
      {content && (
        <div style={{ color: color ?? '#cbd5e1', fontSize: 12, lineHeight: 1.6 }}>{content}</div>
      )}
      {children}
    </div>
  );
}
