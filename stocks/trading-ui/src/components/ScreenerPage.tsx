import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

// ── Types ──────────────────────────────────────────────────────────────────

interface RankRow {
  rank_type: string;
  rank_order: number;
  symbol: string;
  metric_value: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  previous_close?: number;
  volume?: number;
}

interface ActiveRow {
  rank_order: number;
  symbol: string;
  score: number;
}

type ScreenerTab = 'gappers' | 'gainers_session' | 'gainers_intraday' | 'high_session' | 'high_current' | 'combined';

interface Filters {
  search: string;
  minMetric: string;
  maxMetric: string;
  minVolume: string;
  minPrice: string;
  maxPrice: string;
}

const TAB_CONFIG: { key: ScreenerTab; label: string; metricLabel: string }[] = [
  { key: 'gappers', label: 'Gappers', metricLabel: 'Gap %' },
  { key: 'gainers_session', label: 'Gainers Session', metricLabel: 'Gain %' },
  { key: 'gainers_intraday', label: 'Gainers Intraday', metricLabel: 'Gain %' },
  { key: 'high_session', label: 'High of Day', metricLabel: 'High %' },
  { key: 'high_current', label: 'Current High', metricLabel: 'High %' },
  { key: 'combined', label: 'Combined', metricLabel: 'Score' },
];

const DEFAULT_FILTERS: Filters = { search: '', minMetric: '', maxMetric: '', minVolume: '', maxPrice: '', minPrice: '' };

// ── Helpers ────────────────────────────────────────────────────────────────

const fmtVol = (n: number | undefined) => {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
};

const fmtPrice = (n: number | undefined) => (n != null ? `$${n.toFixed(2)}` : '—');
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

// ── Component ──────────────────────────────────────────────────────────────

export default function ScreenerPage() {
  const [tab, setTab] = useState<ScreenerTab>('combined');
  const [gappers, setGappers] = useState<RankRow[]>([]);
  const [gainersSession, setGainersSession] = useState<RankRow[]>([]);
  const [gainersIntraday, setGainersIntraday] = useState<RankRow[]>([]);
  const [highSession, setHighSession] = useState<RankRow[]>([]);
  const [highCurrent, setHighCurrent] = useState<RankRow[]>([]);
  const [combined, setCombined] = useState<ActiveRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [gapRes, gainRes, highRes, activeRes] = await Promise.all([
        axios.get<RankRow[]>('/api/screener/gappers'),
        axios.get<{ session: RankRow[]; intraday: RankRow[] }>('/api/screener/gainers'),
        axios.get<{ session: RankRow[]; current: RankRow[] }>('/api/screener/highs'),
        axios.get<ActiveRow[]>('/api/screener/active'),
      ]);
      setGappers(gapRes.data);
      setGainersSession(gainRes.data.session ?? []);
      setGainersIntraday(gainRes.data.intraday ?? []);
      setHighSession(highRes.data.session ?? []);
      setHighCurrent(highRes.data.current ?? []);
      setCombined(activeRes.data ?? []);
      setLastUpdate(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Screener fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchAll, 60_000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchAll]);

  // Get rows for current tab
  const getRows = (): { symbol: string; metric: number; open?: number; high?: number; low?: number; close?: number; previous_close?: number; volume?: number; rank: number }[] => {
    if (tab === 'combined') {
      return combined.map((r) => ({ symbol: r.symbol, metric: r.score, rank: r.rank_order }));
    }
    const map: Record<string, RankRow[]> = {
      gappers, gainers_session: gainersSession, gainers_intraday: gainersIntraday,
      high_session: highSession, high_current: highCurrent,
    };
    return (map[tab] ?? []).map((r) => ({
      symbol: r.symbol, metric: r.metric_value, open: r.open, high: r.high,
      low: r.low, close: r.close, previous_close: r.previous_close,
      volume: r.volume, rank: r.rank_order,
    }));
  };

  // Apply filters
  const applyFilters = (rows: ReturnType<typeof getRows>) => {
    return rows.filter((r) => {
      if (filters.search && !r.symbol.toUpperCase().includes(filters.search.toUpperCase())) return false;
      if (filters.minMetric && r.metric < parseFloat(filters.minMetric)) return false;
      if (filters.maxMetric && r.metric > parseFloat(filters.maxMetric)) return false;
      if (filters.minVolume && (r.volume ?? 0) < parseFloat(filters.minVolume)) return false;
      if (filters.minPrice && (r.close ?? 0) < parseFloat(filters.minPrice)) return false;
      if (filters.maxPrice && (r.close ?? 0) > parseFloat(filters.maxPrice)) return false;
      return true;
    });
  };

  const filteredRows = applyFilters(getRows());
  const currentTabConfig = TAB_CONFIG.find((t) => t.key === tab)!;

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>
          Screener
          {lastUpdate && <span style={{ fontSize: 11, color: '#64748b', fontWeight: 400, marginLeft: 12 }}>Last update: {lastUpdate}</span>}
        </h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 11, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              style={{ accentColor: '#3b82f6' }}
            />
            Auto-refresh 60s
          </label>
          <button
            onClick={fetchAll}
            disabled={loading}
            style={{
              padding: '5px 14px', borderRadius: 6, border: '1px solid #334155',
              background: loading ? '#1e293b' : '#1e293b', color: '#e2e8f0',
              fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {TAB_CONFIG.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: tab === key ? '1px solid #3b82f6' : '1px solid #334155',
              background: tab === key ? 'rgba(59,130,246,0.15)' : 'transparent',
              color: tab === key ? '#60a5fa' : '#94a3b8',
              transition: 'all 0.15s',
            }}
          >
            {label}
            <span style={{ marginLeft: 6, fontSize: 10, color: tab === key ? '#60a5fa' : '#475569' }}>
              {tab === key ? filteredRows.length : ''}
            </span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap', padding: '10px 14px',
        background: '#131820', borderRadius: 8, border: '1px solid #232d3f',
      }}>
        <FilterInput label="Symbol" value={filters.search} placeholder="AAPL"
          onChange={(v) => setFilters((f) => ({ ...f, search: v }))} width={90} />
        <FilterInput label={`Min ${currentTabConfig.metricLabel}`} value={filters.minMetric} placeholder="0"
          onChange={(v) => setFilters((f) => ({ ...f, minMetric: v }))} width={80} type="number" />
        <FilterInput label={`Max ${currentTabConfig.metricLabel}`} value={filters.maxMetric} placeholder="999"
          onChange={(v) => setFilters((f) => ({ ...f, maxMetric: v }))} width={80} type="number" />
        <FilterInput label="Min Vol" value={filters.minVolume} placeholder="500000"
          onChange={(v) => setFilters((f) => ({ ...f, minVolume: v }))} width={100} type="number" />
        <FilterInput label="Min Price" value={filters.minPrice} placeholder="0"
          onChange={(v) => setFilters((f) => ({ ...f, minPrice: v }))} width={80} type="number" />
        <FilterInput label="Max Price" value={filters.maxPrice} placeholder="999"
          onChange={(v) => setFilters((f) => ({ ...f, maxPrice: v }))} width={80} type="number" />
        <button
          onClick={() => setFilters(DEFAULT_FILTERS)}
          style={{
            alignSelf: 'flex-end', padding: '4px 10px', borderRadius: 4,
            border: '1px solid #334155', background: 'transparent',
            color: '#64748b', fontSize: 11, cursor: 'pointer', marginBottom: 1,
          }}
        >
          Clear
        </button>
      </div>

      {/* Table */}
      <div style={{
        flex: 1, overflow: 'auto', borderRadius: 8,
        border: '1px solid #232d3f', background: '#0f1318',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ position: 'sticky', top: 0, background: '#131820', zIndex: 1 }}>
              <Th>#</Th>
              <Th align="left">Symbol</Th>
              <Th>{currentTabConfig.metricLabel}</Th>
              {tab !== 'combined' && <>
                <Th>Open</Th>
                <Th>High</Th>
                <Th>Low</Th>
                <Th>Close</Th>
                <Th>Prev Close</Th>
                <Th>Volume</Th>
              </>}
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={tab === 'combined' ? 3 : 9} style={{ padding: 24, textAlign: 'center', color: '#475569' }}>
                  {loading ? 'Loading...' : 'No data'}
                </td>
              </tr>
            ) : (
              filteredRows.map((r, i) => (
                <tr
                  key={r.symbol}
                  style={{
                    borderBottom: '1px solid #1a2030',
                    background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                  }}
                >
                  <Td mono>{r.rank}</Td>
                  <Td align="left" bold color="#e2e8f0">{r.symbol}</Td>
                  <Td mono color={r.metric >= 0 ? '#22c55e' : '#ef4444'}>{fmtPct(r.metric)}</Td>
                  {tab !== 'combined' && <>
                    <Td mono>{fmtPrice(r.open)}</Td>
                    <Td mono>{fmtPrice(r.high)}</Td>
                    <Td mono>{fmtPrice(r.low)}</Td>
                    <Td mono>{fmtPrice(r.close)}</Td>
                    <Td mono>{fmtPrice(r.previous_close)}</Td>
                    <Td mono>{fmtVol(r.volume)}</Td>
                  </>}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer count */}
      <div style={{ fontSize: 11, color: '#475569', textAlign: 'right' }}>
        Showing {filteredRows.length} of {getRows().length} symbols
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function FilterInput({ label, value, onChange, placeholder, width = 100, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; width?: number; type?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width, padding: '4px 8px', borderRadius: 4, fontSize: 12,
          border: '1px solid #334155', background: '#0b0e14', color: '#e2e8f0',
          fontFamily: type === 'number' ? 'JetBrains Mono, monospace' : 'inherit',
        }}
      />
    </div>
  );
}

function Th({ children, align = 'right' }: { children: React.ReactNode; align?: string }) {
  return (
    <th style={{
      padding: '8px 12px', textAlign: align as any, fontSize: 10,
      fontWeight: 700, color: '#64748b', textTransform: 'uppercase',
      letterSpacing: 0.5, borderBottom: '1px solid #232d3f',
    }}>
      {children}
    </th>
  );
}

function Td({ children, mono, bold, color, align = 'right' }: {
  children: React.ReactNode; mono?: boolean; bold?: boolean; color?: string; align?: string;
}) {
  return (
    <td style={{
      padding: '7px 12px', textAlign: align as any, color: color ?? '#94a3b8',
      fontFamily: mono ? 'JetBrains Mono, monospace' : 'inherit',
      fontWeight: bold ? 600 : 400, fontSize: 12,
    }}>
      {children}
    </td>
  );
}
