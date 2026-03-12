import { useState, useCallback, useEffect, useRef, KeyboardEvent } from 'react';
import axios from 'axios';
import CandleChart from './components/CandleChart';
import type { CandleChartHandle } from './components/CandleChart';
import AnalysisPanel from './components/AnalysisPanel';
import StatBadge from './components/StatBadge';
import NewsPanel from './components/NewsPanel';
import MomoDropdown from './components/MomoDropdown';
import StrategyGuide from './components/StrategyGuide';
import StrategyInfoPanel from './components/StrategyInfoPanel';
import LogsPanel from './components/LogsPanel';
import DebugPanel from './components/DebugPanel';
import BacktestPage from './components/BacktestPage';
import { useCollectorSocket } from './hooks/useCollectorSocket';
import type { PredictSignalPayload, TradeEntryPayload, TradeExitPayload } from './hooks/useCollectorSocket';
import type { StockSnapshot, AnalyzeResponse, CatalystAnalysis, MomoStock } from './types';

type Page = 'trading' | 'backtest';
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
  const [page, setPage] = useState<Page>('trading');
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
  const [fastPath, setFastPath] = useState(true); // pipeline determinístico ~2-15s vs agentic ~20-40s
  // Momo scanner dropdown
  const [momoStocks, setMomoStocks] = useState<MomoStock[]>([]);
  const [momoLoading, setMomoLoading] = useState(false);
  const [showMomo, setShowMomo] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);

  // Date picker: today by default, historical dates → MySQL (stock-training)
  const getTodayET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const [selectedDate, setSelectedDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  // Simulation mode: limit data visible to agent/chart up to a specific ET datetime
  const [simMode, setSimMode] = useState(false);
  const [simDatetime, setSimDatetime] = useState(''); // value from <input type="datetime-local">
  const [replayCutoffMs, setReplayCutoffMs] = useState<number | null>(null);
  // Patrón actual (polling cada 1s)
  const [currentPattern, setCurrentPattern] = useState<{ name: string | null; viable: boolean } | null>(null);

  // ── Trade signals & toasts ──
  interface Toast { id: number; msg: string; color: string; ts: number }
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  const addToast = useCallback((msg: string, color = '#22c55e') => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev.slice(-9), { id, msg, color, ts: Date.now() }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 8000);
  }, []);

  // Audio beep via Web Audio API (no files needed)
  const playBeep = useCallback((freq = 880, duration = 0.18) => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch { /* audio not available */ }
  }, []);

  // ── Real-time collector ──
  const chart1mRef = useRef<CandleChartHandle>(null);
  const isToday = selectedDate === getTodayET();
  const { activeSymbols } = useCollectorSocket(
    isToday && ticker ? ticker : null,
    isToday ? selectedDate : null,
    useCallback((payload) => {
      chart1mRef.current?.appendCandle(payload.candle);
    }, []),
    useCallback((symbols: string[]) => {
      // If viewing today and the momo dropdown is open, merge new symbols
      setMomoStocks((prev) => {
        const existing = new Set(prev.map((s) => s.symbol));
        const newOnes = symbols.filter((s) => !existing.has(s)).map((s) => ({
          symbol: s,
          price: 0,
          change: 0,
          volume: 0,
          float: null as number | null,
        } as MomoStock));
        return newOnes.length ? [...prev, ...newOnes] : prev;
      });
    }, []),
    // predict:signal
    useCallback((sig: PredictSignalPayload) => {
      const pctStr = (sig.prob * 100).toFixed(1);
      if (sig.tradeable) {
        playBeep(880, 0.18);
        setTimeout(() => playBeep(1100, 0.15), 200);
        addToast(`🟢 ${sig.symbol} ${sig.time} — prob ${pctStr}%  BUY SIGNAL`, '#22c55e');
      } else {
        addToast(`⚪ ${sig.symbol} ${sig.time} — prob ${pctStr}%`, '#64748b');
      }
    }, [playBeep, addToast]),
    // trade:entry
    useCallback((entry: TradeEntryPayload) => {
      playBeep(660, 0.25);
      addToast(
        `📥 BOUGHT ${entry.symbol} ${entry.time} — ${entry.qty.toFixed(4)} @ $${entry.price.toFixed(2)} ($${entry.dollarAmount.toFixed(0)})`,
        '#3b82f6',
      );
    }, [playBeep, addToast]),
    // trade:exit
    useCallback((exit: TradeExitPayload) => {
      const pnlColor = exit.pnl >= 0 ? '#22c55e' : '#ef4444';
      const pnlSign = exit.pnl >= 0 ? '+' : '';
      playBeep(440, 0.3);
      addToast(
        `📤 SOLD ${exit.symbol} ${exit.time} — ${pnlSign}$${exit.pnl.toFixed(2)} (${exit.candlesHeld} candles)`,
        pnlColor,
      );
    }, [playBeep, addToast]),
  );

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

  const loadChart = useCallback(async (sym: string, dateOverride?: string) => {
    setStatus('loading-chart');
    setError('');
    setSnapshot(null);
    setAnalysis(null);
    setNewsData(null);
    setCurrentPattern(null);
    try {
      const cutoff = simCutoffMs();
      const params = new URLSearchParams();
      if (cutoff) params.set('cutoff', String(cutoff));
      const dateToUse = dateOverride ?? selectedDate;
      if (dateToUse && dateToUse !== getTodayET()) params.set('date', dateToUse);
      const url = `/api/scanner/snapshot/${sym}${params.toString() ? '?' + params.toString() : ''}`;
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
  }, [simMode, simDatetime, selectedDate]);

  const handleSyncToday = useCallback(async () => {
    if (syncLoading) return;
    setSyncLoading(true);
    try {
      const { data } = await axios.post<{ ok: boolean; skipped?: boolean; reason?: string }>(
        '/api/collector/sync-today',
      );
      if (data.skipped) {
        const reason = data.reason === 'after_hours' ? 'after hours' : 'no symbols activos';
        addToast(`Sync hoy omitido: ${reason}`, '#f59e0b');
      } else {
        addToast('Sync hoy iniciado', '#22c55e');
      }
    } catch (e: any) {
      addToast(e?.response?.data?.message || e.message || 'Sync hoy fallo', '#ef4444');
    } finally {
      setSyncLoading(false);
    }
  }, [addToast, syncLoading]);

  const runAnalysis = useCallback(async () => {
    if (!ticker) return;
    setStatus('loading-analysis');
    setError('');
    try {
      const cutoff = simCutoffMs();
      const timeframe = (tab === '1m' || tab === '5m') ? tab : '5m';
      const { data } = await axios.post<AnalyzeResponse>('/api/agent/analyze', {
        ticker,
        account_size: Number(accountSize) || 25000,
        timeframe,
        fast: fastPath,
        ...(cutoff ? { cutoff_ms: cutoff } : {}),
      }, { timeout: fastPath ? 60_000 : 180_000 }); // fast: 1 min; agentic: 3 min
      setAnalysis(data);
      setStatus('done');
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Analysis failed');
      setStatus('error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, accountSize, tab, fastPath, simMode, simDatetime]);

  const handleSearch = () => {
    const sym = input.trim().toUpperCase();
    if (!sym) return;
    setShowMomo(false);
    setSimMode(false);
    setSimDatetime('');
    setReplayCutoffMs(null);
    loadChart(sym);
  };

  const handleClear = () => {
    setInput('');
    setTicker('');
    setSnapshot(null);
    setAnalysis(null);
    setNewsData(null);
    setCurrentPattern(null);
    setStatus('idle');
    setError('');
  };

  const fetchMomoList = () => {
    setMomoLoading(true);
    const isToday = selectedDate === getTodayET();
    const url = isToday
      ? '/api/scanner/momo'
      : `/api/scanner/topmovers?date=${selectedDate}`;
    axios.get<MomoStock[]>(url)
      .then(({ data }) => setMomoStocks(data))
      .catch(() => setMomoStocks([]))
      .finally(() => setMomoLoading(false));
  };

  const handleMomoFocus = () => {
    setShowMomo(true);
    fetchMomoList();
  };

  const handleInputClick = () => {
    // If already focused, toggle the dropdown
    if (!showMomo) {
      setShowMomo(true);
      fetchMomoList();
    }
  };

  const handleMomoSelect = (symbol: string) => {
    setInput(symbol);
    setShowMomo(false);
    setSimMode(false);
    setSimDatetime('');
    setReplayCutoffMs(null);
    loadChart(symbol);
  };

  useEffect(() => {
    axios.get<{ dates: string[] }>('/api/scanner/dates')
      .then(({ data }) => setAvailableDates(data.dates ?? []))
      .catch(() => setAvailableDates([]));
  }, []);

  const onDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const d = e.target.value;
    if (!d) return;
    setSelectedDate(d);
    setMomoStocks([]);
    if (showMomo) {
      setMomoLoading(true);
      const url = d === getTodayET() ? '/api/scanner/momo' : `/api/scanner/topmovers?date=${d}`;
      axios.get<MomoStock[]>(url)
        .then(({ data }) => setMomoStocks(data))
        .catch(() => setMomoStocks([]))
        .finally(() => setMomoLoading(false));
    }
  };

  // Cuando cambia la fecha y hay ticker, refetch (asegura que la API se llame)
  useEffect(() => {
    if (!ticker || !selectedDate) return;
    const params = new URLSearchParams();
    if (selectedDate !== getTodayET()) params.set('date', selectedDate);
    setStatus('loading-chart');
    setSnapshot(null);
    setAnalysis(null);
    axios
      .get<StockSnapshot>(`/api/scanner/snapshot/${ticker}${params.toString() ? '?' + params.toString() : ''}`)
      .then(({ data }) => {
        setSnapshot(data);
        setStatus('idle');
      })
      .catch((e) => {
        setError(e?.response?.data?.message || e.message || 'Failed to fetch');
        setStatus('error');
      });
  // Solo al cambiar selectedDate (no al montar, para evitar doble fetch con loadChart)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // Poll strategy every 2s en Replay (usa snapshot que sí existe). Sin Replay, usa strategy del snapshot ya cargado.
  useEffect(() => {
    if (!ticker || !snapshot) return;
    if (!simMode) {
      setCurrentPattern(snapshot.strategy ? { name: snapshot.strategy.name, viable: snapshot.strategy.viable } : null);
      return;
    }
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const cutoff = simCutoffMs();
    const params = new URLSearchParams();
    if (cutoff) params.set('cutoff', String(cutoff));
    if (selectedDate && selectedDate !== getTodayET()) params.set('date', selectedDate);
    const url = `/api/scanner/snapshot/${ticker}${params.toString() ? '?' + params.toString() : ''}`;
    const fetchStrategy = () => {
      if (cancelled) return;
      axios.get<StockSnapshot>(url)
        .then(({ data }) => {
          if (!cancelled && data.strategy)
            setCurrentPattern({ name: data.strategy.name, viable: data.strategy.viable });
        })
        .catch(() => { /* ignore */ });
    };
    fetchStrategy();
    intervalId = setInterval(fetchStrategy, 2000);
    return () => { cancelled = true; if (intervalId) clearInterval(intervalId); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, snapshot?.ticker, simMode, simDatetime, selectedDate]);

  // When Replay is turned OFF, reload full data for the current ticker
  useEffect(() => {
    if (!simMode && ticker) {
      setSimDatetime('');
      setStatus('loading-chart');
      setSnapshot(null);
      setAnalysis(null);
      const params = selectedDate && selectedDate !== getTodayET() ? `?date=${selectedDate}` : '';
      axios.get<StockSnapshot>(`/api/scanner/snapshot/${ticker}${params}`)
        .then(({ data }) => { setSnapshot(data); setStatus('idle'); })
        .catch((e) => { setError(e?.response?.data?.message || e.message); setStatus('error'); });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simMode, selectedDate]);

  /** Called when user clicks a candle in Replay mode — sets cutoff to that candle's time */
  const handleCandleClick = useCallback((ms: number) => {
    if (!simMode || !ticker) return;
    setReplayCutoffMs(ms);
    const etStr = new Date(ms).toLocaleString('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    }).replace(', ', 'T').slice(0, 16);
    setSimDatetime(etStr);
    const params = new URLSearchParams({ cutoff: String(ms) });
    if (selectedDate && selectedDate !== getTodayET()) params.set('date', selectedDate);
    const url = `/api/scanner/snapshot/${ticker}?${params.toString()}`;
    setStatus('loading-chart');
    setAnalysis(null);
    axios.get<StockSnapshot>(url)
      .then(({ data }) => { setSnapshot(data); setStatus('idle'); })
      .catch((e) => { setError(e?.response?.data?.message || e.message); setStatus('error'); });
  }, [simMode, ticker, selectedDate]);

  /** Step +1 or -1 candle in replay mode */
  const handleReplayStep = useCallback((dir: 1 | -1) => {
    if (!simMode || !ticker || !snapshot) return;
    const candles = tab === '5m' ? snapshot.candles_5min : snapshot.candles_1min;
    if (!candles.length) return;
    const intervalMs = tab === '5m' ? 5 * 60_000 : 60_000;
    const lastCandleMs = candles[candles.length - 1].t;
    if (dir === 1) {
      // Step forward: one interval past the last visible candle
      handleCandleClick(lastCandleMs + intervalMs);
    } else {
      // Step backward: remove last candle (use second-to-last candle's time)
      if (candles.length < 2) return;
      handleCandleClick(candles[candles.length - 2].t);
    }
  }, [simMode, ticker, snapshot, tab, handleCandleClick]);

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
          <button
            onClick={() => setShowLogs(true)}
            title="Historial de análisis (debug)"
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'rgba(34,197,94,0.15)',
              border: '1px solid rgba(34,197,94,0.4)',
              color: '#22c55e',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            📋
          </button>
          <button
            onClick={() => setShowDebug(true)}
            title="Debug: WebSocket, symbols, positions"
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'rgba(245,158,11,0.15)',
              border: '1px solid rgba(245,158,11,0.4)',
              color: '#f59e0b',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            🔧
          </button>
        </div>

        {/* Page tabs */}
        <div style={{ display: 'flex', gap: 4, marginRight: 8 }}>
          {([['trading', '📈 Trading'], ['backtest', '🔮 Backtest']] as const).map(([p, label]) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              style={{
                padding: '5px 12px',
                borderRadius: 6,
                border: page === p ? '1px solid #3b82f6' : '1px solid #334155',
                background: page === p ? 'rgba(59,130,246,0.15)' : 'transparent',
                color: page === p ? '#60a5fa' : '#64748b',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Ticker search (only on trading page) */}
        {page === 'trading' && (<>
        <div style={{ display: 'flex', gap: 8, flex: 1, maxWidth: 380, position: 'relative' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              onKeyDown={handleKey}
              onFocus={handleMomoFocus}
              onClick={handleInputClick}
              onBlur={() => setTimeout(() => setShowMomo(false), 150)}
              placeholder="Ticker ↵  (ej: SOUN, GME…) ↓ movers"
              maxLength={8}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: '#1a2030',
                border: `1px solid ${showMomo ? '#3b82f6' : '#2d3f55'}`,
                borderRadius: 8,
                color: '#e2e8f0',
                padding: '8px 34px 8px 14px',
                fontSize: 14,
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 600,
                letterSpacing: '0.05em',
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
            />
            {(input || ticker) && (
              <button
                onClick={handleClear}
                title="Limpiar ticker"
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: '#64748b',
                  fontSize: 16,
                  cursor: 'pointer',
                  padding: '0 4px',
                  lineHeight: 1,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                ×
              </button>
            )}
            {showMomo && (
              <MomoDropdown
                stocks={momoStocks}
                loading={momoLoading}
                filter={input}
                onSelect={handleMomoSelect}
                sourceLabel={selectedDate === getTodayET() ? 'momoscreener' : 'MySQL'}
              />
            )}
          </div>
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

        {/* Fast path toggle */}
        <button
          onClick={() => setFastPath((v) => !v)}
          title={fastPath ? 'Fast path: pipeline determinístico (~2-15s). Desactiva para modo agentic completo.' : 'Agentic: LLM elige herramientas (~20-40s)'}
          style={{
            padding: '7px 12px',
            background: fastPath ? 'rgba(34,197,94,0.15)' : '#1a2030',
            border: `1px solid ${fastPath ? 'rgba(34,197,94,0.5)' : '#2d3f55'}`,
            borderRadius: 8,
            color: fastPath ? '#4ade80' : '#475569',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "'JetBrains Mono', monospace",
            whiteSpace: 'nowrap',
            transition: 'all 0.15s',
          }}
        >
          ⚡ {fastPath ? 'Fast' : 'Agentic'}
        </button>

        {/* Date picker + Simulation mode */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="date"
              value={selectedDate}
              onChange={onDateChange}
              max={getTodayET()}
              title="Fecha: hoy = momo live, otra = MySQL histórico (stock-training)"
              style={{
                background: '#1a2030',
                border: '1px solid #2d3f55',
                borderRadius: 8,
                color: '#e2e8f0',
                padding: '7px 10px',
                fontSize: 12,
                fontFamily: "'JetBrains Mono', monospace",
                outline: 'none',
                colorScheme: 'dark',
              }}
            />
            <span style={{ fontSize: 10, color: '#64748b', whiteSpace: 'nowrap' }}>ET</span>
          </div>

          <button
            onClick={handleSyncToday}
            disabled={!isToday || syncLoading}
            title={isToday ? 'Sync candles del dia de hoy (momo)' : 'Solo disponible para hoy'}
            style={{
              padding: '7px 10px',
              background: syncLoading ? '#1f2937' : 'rgba(14,165,233,0.15)',
              border: `1px solid ${syncLoading ? '#334155' : 'rgba(14,165,233,0.5)'}`,
              borderRadius: 8,
              color: syncLoading ? '#64748b' : '#38bdf8',
              cursor: (!isToday || syncLoading) ? 'not-allowed' : 'pointer',
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              whiteSpace: 'nowrap',
            }}
          >
            {syncLoading ? 'Sync...' : 'Sync hoy'}
          </button>

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
        </>)}
      </header>

      {/* ── Page body ── */}
      {page === 'backtest' ? (
        <BacktestPage />
      ) : (
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
                {(currentPattern?.name ?? snapshot.strategy?.name) && (
                  <div style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    background: (currentPattern ?? snapshot.strategy)?.viable ? 'rgba(34,197,94,0.15)' : 'rgba(234,179,8,0.15)',
                    border: `1px solid ${(currentPattern ?? snapshot.strategy)?.viable ? 'rgba(34,197,94,0.4)' : 'rgba(234,179,8,0.4)'}`,
                    color: (currentPattern ?? snapshot.strategy)?.viable ? '#4ade80' : '#eab308',
                    fontSize: 13,
                    fontWeight: 700,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    📐 {(currentPattern ?? snapshot.strategy)?.name}
                  </div>
                )}
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

                {/* Replay controls — next to chart tabs */}
                {tab !== 'news' && (
                  <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px', gap: 6 }}>
                    <button
                      onClick={() => { setSimMode((v) => { if (v) { setReplayCutoffMs(null); setSimDatetime(''); } return !v; }); }}
                      title="Simulation mode: replay data up to a specific time"
                      style={{
                        padding: '5px 10px',
                        background: simMode ? 'rgba(245,158,11,0.15)' : 'transparent',
                        border: `1px solid ${simMode ? 'rgba(245,158,11,0.5)' : '#2d3f55'}`,
                        borderRadius: 6,
                        color: simMode ? '#fbbf24' : '#475569',
                        cursor: 'pointer',
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: "'JetBrains Mono', monospace",
                        whiteSpace: 'nowrap',
                        transition: 'all 0.15s',
                      }}
                    >
                      ⏪ {simMode ? 'REPLAY ON' : 'Replay'}
                    </button>
                    {simMode && replayCutoffMs && (
                      <>
                        <button
                          onClick={() => handleReplayStep(-1)}
                          disabled={isLoading}
                          title="Retroceder 1 vela"
                          style={{
                            padding: '4px 8px',
                            background: '#1a2030',
                            border: '1px solid rgba(245,158,11,0.4)',
                            borderRadius: 6,
                            color: '#fbbf24',
                            cursor: isLoading ? 'not-allowed' : 'pointer',
                            fontSize: 13,
                            fontWeight: 700,
                            opacity: isLoading ? 0.5 : 1,
                            lineHeight: 1,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 28,
                            height: 28,
                          }}
                        >
                          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><path d="M10 0L0 6l10 6z"/></svg>
                        </button>
                        <button
                          onClick={() => handleReplayStep(1)}
                          disabled={isLoading}
                          title="Avanzar 1 vela"
                          style={{
                            padding: '4px 8px',
                            background: '#1a2030',
                            border: '1px solid rgba(245,158,11,0.4)',
                            borderRadius: 6,
                            color: '#fbbf24',
                            cursor: isLoading ? 'not-allowed' : 'pointer',
                            fontSize: 13,
                            fontWeight: 700,
                            opacity: isLoading ? 0.5 : 1,
                            lineHeight: 1,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 28,
                            height: 28,
                          }}
                        >
                          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><path d="M0 0l10 6-10 6z"/></svg>
                        </button>
                        <span style={{ fontSize: 10, color: '#92400e', fontFamily: "'JetBrains Mono', monospace" }}>
                          {simDatetime.split('T')[1] || ''} ET
                        </span>
                      </>
                    )}
                  </div>
                )}

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
                  ref={chart1mRef}
                  key={`1m-${snapshot.ticker}`}
                  candles={snapshot.candles_1min ?? []}
                  title={`${snapshot.ticker} · 1 min  (ET)`}
                  vwap={snapshot.vwap}
                  vwap_line={snapshot.vwap_line}
                  ema9={snapshot.ema9}
                  ema20={snapshot.ema20}
                  height={380}
                  simMode={simMode}
                  onCandleClick={simMode ? handleCandleClick : undefined}
                  strategy={currentPattern ? { name: currentPattern.name, viable: currentPattern.viable, entry: null, stop: null, target_1: null, target_2: null, pattern_signals: [] } : snapshot.strategy}
                  atr={snapshot.atr}
                  highOfDay={snapshot.high_of_day}
                  lowOfDay={snapshot.low_of_day}
                  preMarketHigh={snapshot.pre_market_high}
                  changePct={snapshot.change_pct}
                  ticker={ticker}
                  selectedDate={selectedDate}
                />
              )}
              {tab === '5m' && (
                <CandleChart
                  key={`5m-${snapshot.ticker}`}
                  candles={snapshot.candles_5min ?? []}
                  title={`${snapshot.ticker} · 5 min  (ET)`}
                  vwap={snapshot.vwap}
                  vwap_line={snapshot.vwap_line}
                  ema9={snapshot.ema9}
                  ema20={snapshot.ema20}
                  height={380}
                  simMode={simMode}
                  onCandleClick={simMode ? handleCandleClick : undefined}
                  strategy={currentPattern ? { name: currentPattern.name, viable: currentPattern.viable, entry: null, stop: null, target_1: null, target_2: null, pattern_signals: [] } : snapshot.strategy}
                  atr={snapshot.atr}
                  highOfDay={snapshot.high_of_day}
                  lowOfDay={snapshot.low_of_day}
                  preMarketHigh={snapshot.pre_market_high}
                  changePct={snapshot.change_pct}
                  ticker={ticker}
                  selectedDate={selectedDate}
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

            {/* Strategy info panel with guidance */}
            {snapshot.strategy?.name && (
              <StrategyInfoPanel strategy={snapshot.strategy} />
            )}
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
      )}

      {showGuide && <StrategyGuide onClose={() => setShowGuide(false)} />}
      {showLogs && <LogsPanel onClose={() => setShowLogs(false)} />}
      {showDebug && <DebugPanel onClose={() => setShowDebug(false)} />}

      {/* ── Trade signal toasts (bottom-right) ── */}
      {toasts.length > 0 && (
        <div style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          zIndex: 9999,
          maxWidth: 420,
          pointerEvents: 'none',
        }}>
          {toasts.map((t) => (
            <div
              key={t.id}
              style={{
                padding: '10px 16px',
                background: '#131820',
                border: `1px solid ${t.color}55`,
                borderLeft: `4px solid ${t.color}`,
                borderRadius: 8,
                color: t.color,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "'JetBrains Mono', monospace",
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                animation: 'fadeInRight 0.3s ease',
                pointerEvents: 'auto',
              }}
            >
              {t.msg}
            </div>
          ))}
        </div>
      )}
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
