interface Props {
  label: string;
  value: string | number | null;
  color?: string;
  mono?: boolean;
}

export default function StatBadge({ label, value, color = '#94a3b8', mono = false }: Props) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      padding: '8px 12px',
      background: '#1a2030',
      borderRadius: 8,
      border: '1px solid #232d3f',
      minWidth: 90,
    }}>
      <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </span>
      <span style={{
        fontSize: 15,
        fontWeight: 600,
        color,
        fontFamily: mono ? "'JetBrains Mono', monospace" : 'inherit',
      }}>
        {value ?? '—'}
      </span>
    </div>
  );
}
