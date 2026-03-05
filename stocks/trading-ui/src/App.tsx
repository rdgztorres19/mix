import { useState, useCallback, useEffect, KeyboardEvent } from 'react';
import axios from 'axios';
import CandleChart from './components/CandleChart';
import AnalysisPanel from './components/AnalysisPanel';
import StatBadge from './components/StatBadge';
import NewsPanel from './components/NewsPanel';
import MomoDropdown from './components/MomoDropdown';
import StrategyGuide from './components/StrategyGuide';
import type { StockSnapshot, AnalyzeResponse, CatalystAnalysis, MomoStock } from './types';

type Tab = '1m' | '5m' | 'news';
type Status = 'idle' | 'loading-chart' | 'loading-analysis' | 'done' | 'error';

const fmt = (n: number | null | undefined, prefix = '$') =>
  n != null ? `${prefix}${n.toFixed(2)}` : '—';

const fmtPct = (n: number | null | undefined) =>
  n != null ? `${(n * 100).toFixed(2)}%` : '—';

const fmtVol = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
};

export default function App() {
  const [input, setInput] = useState('');
  const [ticker, setTicker] = useState('');
  const [tab, setTab] = useState<Tab>('1m');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<StockSnapshot | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [newsData, setNewsData] = useState<CatalystAnalysis | null>(null);
  const [loadingNews, setLoadingNews] = useState(false);
  const [accountSize, setAccountSize] = useState('25000');
  // Momo scanner dropdown
  const [momoStocks, setMomoStocks] = useState<MomoStock[]>([]);
  const [momoLoading, setMomoLoading] = useState(false);
  const [showMomo, setShowMomo] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  // Simulation mode: limit data visible to agent/chart up to a specific ET datetime
  const [simMode, setSimMode] = useState(false);
  const [simDatetime, setSimDatetime] = useState(''); // value from <input type="datetime-local">

  /** Convert a datetime-local string (treated as ET) to unix ms */
  const simCutoffMs = (): number | undefined => {
    if (!simMode || !simDatetime) return undefined;
    // datetime-local gives "YYYY-MM-DDTHH:mm" with no timezone — interpret as ET
    // Append ":00" for seconds and format as ET ISO
    const etStr = simDatetime + ':00';
    // Use Intl to figure out the UTC offset for America/New_York at that moment
    const naive = new Date(etStr); // parsed as local (browser), we override below
    // Build a proper ET date by formatting the naive date back to ET offset
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    // Find offset: parse the datetime-local string assuming it IS ET
    // Simplest robust approach: use a UTC string with offset
    const [datePart, timePart] = simDatetime.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);
    // Determine ET offset (-5 EST or -4 EDT) using a probe date
    const probe = new Date(Date.UTC(year, month - 1, day, hour, minute));
    const etFormatted = formatter.format(probe);
    // ET offset: compare the formatted ET time with the UTC time we used
    const [, etTimePart] = etFormatted.split(', ');
    const [etH] = etTimePart.split(':').map(Number);
    const utcH = probe.getUTCHours();
    const offsetH = etH - utcH; // e.g. -4 for EDT, -5 for EST
    const cutoffUtcMs = probe.getTime() - offsetH * 3600 * 1000;
    return cutoffUtcMs;
  };

  const loadChart = useCallback(async (sym: string) => {
    setStatus('loading-chart');
    setError('');
    setSnapshot(null);
    setAnalysis(null);
    setNewsData(null);
    try {
      const cutoff = simCutoffMs();
      const url = cutoff
        ? `/api/scanner/snapshot/${sym}?cutoff=${cutoff}`
        : `/api/scanner/snapshot/${sym}`;
      const { data } = await axios.get<StockSnapshot>(url);
      setSnapshot(data);
      setTicker(sym);
      setStatus('idle');
      // Fetch news in parallel (non-blocking)
      setLoadingNews(true);
      axios.get<CatalystAnalysis>(`/api/scanner/news/${sym}`)
        .then(({ data: nd }) => setNewsData(nd))
        .catch(() => setNewsData(null))
        .finally(() => setLoadingNews(false));
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Failed to fetch chart data');
      setStatus('error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simMode, simDatetime]);

  const runAnalysis = useCallback(async () => {
    if (!ticker) return;
    setStatus('loading-analysis');
    setError('');
    try {
      const cutoff = simCutoffMs();
      const { data } = await axios.post<AnalyzeResponse>('/api/agent/analyze', {
        ticker,
        account_size: Number(accountSize) || 25000,
        ...(cutoff ? { cutoff_ms: cutoff } : {}),
      });
      setAnalysis(data);
      setStatus('done');
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Analysis failed');
      setStatus('error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, accountSize, simMode, simDatetime]);

  const handleSearch = () => {
    const sym = input.trim().toUpperCase();
    if (!sym) return;
    setShowMomo(false);
    loadChart(sym);
  };

  const handleMomoFocus = () => {
    setShowMomo(true);
    if (momoStocks.length > 0) return; // already loaded
    setMomoLoading(true);
    axios.get<MomoStock[]>('/api/scanner/momo')
      .then(({ data }) => setMomoStocks(data))
      .catch(() => {})
      .finally(() => setMomoLoading(false));
  };

  const handleMomoSelect = (symbol: string) => {
    setInput(symbol);
    setShowMomo(false);
    loadChart(symbol);
  };

  // When Replay is turned OFF, reload full data for the current ticker
  useEffect(() => {
    if (!simMode && ticker) {
      setSimDatetime('');
      setStatus('loading-chart');
      setSnapshot(null);
      setAnalysis(null);
      axios.get<StockSnapshot>(`/api/scanner/snapshot/${ticker}`)
        .then(({ data }) => { setSnapshot(data); setStatus('idle'); })
        .catch((e) => { setError(e?.response?.data?.message || e.message); setStatus('error'); });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simMode]);

  /** Called when user clicks a candle in Replay mode — sets cutoff to that candle's time */
  const handleCandleClick = useCallback((ms: number) => {
    if (!simMode || !ticker) return;
    // Convert unix ms → ET datetime-local string "YYYY-MM-DDTHH:mm"
    const etStr = new Date(ms).toLocaleString('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    }).replace(', ', 'T').slice(0, 16); // "YYYY-MM-DDTHH:mm"
    setSimDatetime(etStr);
    // Re-load chart with new cutoff (loadChart reads simDatetime via simCutoffMs,
    // but state update is async — pass the ms directly instead)
    const url = `/api/scanner/snapshot/${ticker}?cutoff=${ms}`;
    setStatus('loading-chart');
    setSnapshot(null);
    setAnalysis(null);
    axios.get<StockSnapshot>(url)
      .then(({ data }) => { setSnapshot(data); setStatus('idle'); })
      .catch((e) => { setError(e?.response?.data?.message || e.message); setStatus('error'); });
  }, [simMode, ticker]);

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSearch();
  };

  const isLoading = status === 'loading-chart' || status === 'loading-analysis';
  const changePctColor = snapshot
    ? snapshot.change_pct >= 0.10 ? '#22c55e'
    : snapshot.change_pct >= 0 ? '#94a3b8'
    : '#ef4444'
    : '#94a3b8';

  return (
    <div style={{ minHeight: '100vh', background: '#0b0e14', display: 'flex', flexDirection: 'column' }}>
      {/* ── Header ── */}
      <header style={{
        background: '#0f1520',
        borderBottom: '1px solid #1e293b',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 8 }}>
          <span style={{ fontSize: 20 }}>📈</span>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#e2e8f0', letterSpacing: '-0.02em' }}>
            Trading Agent
          </span>
          <button
            onClick={() => setShowGuide(true)}
            title="Guía de estrategias: entrada, salida, confirmación"
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'rgba(59,130,246,0.15)',
              border: '1px solid rgba(59,130,246,0.4)',
              color: '#60a5fa',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            ?
          </button>
        </div>

        {/* Ticker search */}
        <div style={{ display: 'flex', gap: 8, flex: 1, maxWidth: 420, position: 'relative' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              onKeyDown={handleKey}
              onFocus={handleMomoFocus}
              onBlur={() => setTimeout(() => setShowMomo(false), 150)}
              placeholder="Ticker  (ej: SOUN, GME…) ↓ top movers"
              maxLength={8}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: '#1a2030',
                border: `1px solid ${showMomo ? '#3b82f6' : '#2d3f55'}`,
                borderRadius: 8,
                color: '#e2e8f0',
                padding: '8px 14px',
                fontSize: 14,
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 600,
                letterSpacing: '0.05em',
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
            />
            {showMomo && (
              <MomoDropdown
                stocks={momoStocks}
                loading={momoLoading}
                filter={input}
                onSelect={handleMomoSelect}
              />
            )}
          </div>
          <button
            onClick={handleSearch}
            disabled={isLoading || !input.trim()}
            style={btnStyle('#3b82f6', isLoading || !input.trim())}
          >
            {status === 'loading-chart' ? '…' : 'Buscar'}
          </button>
        </div>

        {/* Account size */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#475569' }}>Cuenta $</span>
          <input
            value={accountSize}
            onChange={(e) => setAccountSize(e.target.value)}
            style={{
              width: 100,
              background: '#1a2030',
              border: '1px solid #2d3f55',
              borderRadius: 8,
              color: '#94a3b8',
              padding: '7px 10px',
              fontSize: 13,
              fontFamily: "'JetBrains Mono', monospace",
              outline: 'none',
            }}
          />
        </div>

        {/* Simulation mode */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <button
            onClick={() => setSimMode((v) => !v)}
            title="Simulation mode: replay data up to a specific time"
            style={{
              padding: '7px 12px',
              background: simMode ? 'rgba(245,158,11,0.15)' : '#1a2030',
              border: `1px solid ${simMode ? 'rgba(245,158,11,0.5)' : '#2d3f55'}`,
              borderRadius: 8,
              color: simMode ? '#fbbf24' : '#475569',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "'JetBrains Mono', monospace",
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
            }}
          >
            ⏪ {simMode ? 'REPLAY ON' : 'Replay'}
          </button>
          {simMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="datetime-local"
                value={simDatetime}
                onChange={(e) => setSimDatetime(e.target.value)}
                title="Cutoff time in ET (Eastern Time)"
                style={{
                  background: '#1a2030',
                  border: '1px solid rgba(245,158,11,0.4)',
                  borderRadius: 8,
                  color: '#fbbf24',
                  padding: '7px 10px',
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', monospace",
                  outline: 'none',
                  colorScheme: 'dark',
                }}
              />
              <span style={{ fontSize: 10, color: '#92400e', whiteSpace: 'nowrap' }}>ET</span>
            </div>
          )}
        </div>

        {/* Analyze button */}
        <button
          onClick={runAnalysis}
          disabled={!snapshot || isLoading}
          style={btnStyle('#7c3aed', !snapshot || isLoading)}
        >
          {status === 'loading-analysis' ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Spinner /> Analizando…
            </span>
          ) : '🤖 Analizar'}
        </button>
      </header>

      {/* ── Main content ── */}
      <main style={{ flex: 1, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Error */}
        {status === 'error' && (
          <div style={{
            padding: '12px 16px',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8,
            color: '#fca5a5',
            fontSize: 13,
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* Snapshot stats bar */}
        {snapshot && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {/* Ticker + price */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontSize: 26, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: '#e2e8f0' }}>
                  {snapshot.ticker}
                </span>
                <span style={{ fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: '#e2e8f0' }}>
                  ${snapshot.price.toFixed(2)}
                </span>
                <span style={{
                  fontSize: 14, fontWeight: 600,
                  color: changePctColor,
                  background: `${changePctColor}18`,
                  padding: '2px 8px', borderRadius: 6,
                }}>
                  {snapshot.change_pct >= 0 ? '+' : ''}{fmtPct(snapshot.change_pct)}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 4 }}>
                <StatBadge label="HOD" value={fmt(snapshot.high_of_day)} color="#22c55e" mono />
                <StatBadge label="LOD" value={fmt(snapshot.low_of_day)} color="#ef4444" mono />
                <StatBadge label="VWAP" value={fmt(snapshot.vwap)} color="#facc15" mono />
                <StatBadge label="EMA9" value={fmt(snapshot.ema9)} color="#38bdf8" mono />
                <StatBadge label="EMA20" value={fmt(snapshot.ema20)} color="#a78bfa" mono />
                <StatBadge label="ATR" value={fmt(snapshot.atr)} color="#94a3b8" mono />
                <StatBadge label="Vol" value={fmtVol(snapshot.volume)} />
                <StatBadge
                  label="Rel Vol"
                  value={`${snapshot.relative_volume.toFixed(1)}x`}
                  color={snapshot.relative_volume >= 5 ? '#22c55e' : snapshot.relative_volume >= 2 ? '#eab308' : '#ef4444'}
                  mono
                />
                {snapshot.pre_market_high && (
                  <StatBadge label="PM High" value={fmt(snapshot.pre_market_high)} color="#f97316" mono />
                )}
              </div>
            </div>

            {/* Simulation banner */}
            {simMode && simDatetime && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 16px',
                background: 'rgba(245,158,11,0.08)',
                border: '1px solid rgba(245,158,11,0.3)',
                borderRadius: 10,
                fontSize: 13,
                color: '#fbbf24',
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                <span>⏪</span>
                <span>
                  <strong>REPLAY MODE</strong> — datos hasta{' '}
                  <strong>{simDatetime.replace('T', ' ')} ET</strong>.
                  El agente solo ve lo que existía en ese momento.
                </span>
              </div>
            )}

            {/* Tab switcher + Charts */}
            <div style={{
              background: '#131820',
              border: '1px solid #232d3f',
              borderRadius: 12,
              overflow: 'hidden',
            }}>
              {/* Tabs */}
              <div style={{ display: 'flex', borderBottom: '1px solid #232d3f' }}>
                {(['1m', '5m'] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    style={{
                      padding: '10px 20px',
                      background: tab === t ? '#1a2030' : 'transparent',
                      border: 'none',
                      borderBottom: tab === t ? '2px solid #3b82f6' : '2px solid transparent',
                      color: tab === t ? '#e2e8f0' : '#64748b',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: 13,
                      fontFamily: "'JetBrains Mono', monospace",
                      transition: 'all 0.15s',
                    }}
                  >
                    {t}
                  </button>
                ))}

                {/* News tab */}
                <button
                  onClick={() => setTab('news')}
                  style={{
                    padding: '10px 20px',
                    background: tab === 'news' ? '#1a2030' : 'transparent',
                    border: 'none',
                    borderBottom: tab === 'news' ? '2px solid #f59e0b' : '2px solid transparent',
                    color: tab === 'news' ? '#fbbf24' : '#64748b',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', monospace",
                    transition: 'all 0.15s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  Noticias
                  {loadingNews && (
                    <span style={{ opacity: 0.6 }}><Spinner size={11} /></span>
                  )}
                  {!loadingNews && newsData && (
                    <span style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 10,
                      background: newsData.catalyst_strength === 'STRONG'
                        ? 'rgba(34,197,94,0.2)' : newsData.catalyst_strength === 'MODERATE'
                        ? 'rgba(234,179,8,0.2)' : newsData.catalyst_strength === 'WEAK'
                        ? 'rgba(239,68,68,0.2)' : 'rgba(100,116,139,0.2)',
                      color: newsData.catalyst_strength === 'STRONG'
                        ? '#22c55e' : newsData.catalyst_strength === 'MODERATE'
                        ? '#eab308' : newsData.catalyst_strength === 'WEAK'
                        ? '#ef4444' : '#64748b',
                    }}>
                      {newsData.catalyst_strength}
                    </span>
                  )}
                </button>

                <div style={{ flex: 1 }} />
                {tab !== 'news' && (
                  <div style={{ display: 'flex', alignItems: 'center', padding: '0 14px', gap: 12, fontSize: 11 }}>
                    <LegendDot color="#facc15" label="VWAP" />
                    <LegendDot color="#38bdf8" label="EMA9" />
                    <LegendDot color="#a78bfa" label="EMA20" />
                  </div>
                )}
              </div>

              {/* Chart */}
              {tab === '1m' && (
                <CandleChart
                  key={`1m-${snapshot.ticker}`}
                  candles={snapshot.candles_1min}
                  title={`${snapshot.ticker} · 1 min  (ET)`}
                  vwap={snapshot.vwap}
                  ema9={snapshot.ema9}
                  ema20={snapshot.ema20}
                  height={380}
                  simMode={simMode}
                  onCandleClick={simMode ? handleCandleClick : undefined}
                />
              )}
              {tab === '5m' && (
                <CandleChart
                  key={`5m-${snapshot.ticker}`}
                  candles={snapshot.candles_5min}
                  title={`${snapshot.ticker} · 5 min  (ET)`}
                  vwap={snapshot.vwap}
                  ema9={snapshot.ema9}
                  ema20={snapshot.ema20}
                  height={380}
                  simMode={simMode}
                  onCandleClick={simMode ? handleCandleClick : undefined}
                />
              )}

              {/* News tab content */}
              {tab === 'news' && (
                loadingNews ? (
                  <div style={{
                    padding: 40,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    color: '#64748b',
                    minHeight: 200,
                  }}>
                    <Spinner size={18} />
                    <span>Cargando noticias para {snapshot.ticker}…</span>
                  </div>
                ) : newsData ? (
                  <NewsPanel data={newsData} />
                ) : (
                  <div style={{
                    padding: 40,
                    textAlign: 'center',
                    color: '#475569',
                    minHeight: 200,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    No se pudieron cargar las noticias
                  </div>
                )
              )}
            </div>
          </>
        )}

        {/* Analysis result */}
        {status === 'loading-analysis' && (
          <div style={{
            background: '#131820',
            border: '1px solid #232d3f',
            borderRadius: 12,
            padding: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            color: '#64748b',
          }}>
            <Spinner size={20} />
            <span>El agente está analizando {ticker}…</span>
          </div>
        )}

        {analysis && status === 'done' && (
          <div style={{
            background: '#131820',
            border: '1px solid #232d3f',
            borderRadius: 12,
            padding: 20,
          }}>
            <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 16 }}>
              Análisis del Agente
            </div>
            <AnalysisPanel data={analysis} />
          </div>
        )}

        {/* Empty state */}
        {status === 'idle' && !snapshot && (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            color: '#334155',
            paddingTop: 80,
          }}>
            <span style={{ fontSize: 48 }}>📊</span>
            <span style={{ fontSize: 16, color: '#475569' }}>Ingresa un ticker para ver el gráfico</span>
            <span style={{ fontSize: 13 }}>Ejemplos: SOUN · GME · TSLA · NVDA · AAPL</span>
          </div>
        )}
      </main>

      {showGuide && <StrategyGuide onClose={() => setShowGuide(false)} />}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function btnStyle(color: string, disabled: boolean): React.CSSProperties {
  return {
    padding: '8px 18px',
    background: disabled ? '#1e293b' : color,
    color: disabled ? '#475569' : '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 600,
    fontSize: 13,
    whiteSpace: 'nowrap',
    transition: 'background 0.15s',
  };
}

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      style={{ animation: 'spin 0.7s linear infinite' }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="12" cy="12" r="9" strokeOpacity={0.25} />
      <path d="M12 3a9 9 0 0 1 9 9" />
    </svg>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#64748b' }}>
      <div style={{ width: 14, height: 2, background: color, borderRadius: 1 }} />
      <span>{label}</span>
    </div>
  );
}
