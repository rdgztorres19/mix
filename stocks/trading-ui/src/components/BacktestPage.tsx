import { useState, useCallback, useRef, useEffect } from 'react';
import axios from 'axios';
import { TradeDetailChart } from './TradeDetailChart';

interface BacktestRow {
  time: string;
  open: number; high: number; low: number; close: number;
  volume: number; prob: number; tradeable: boolean;
  mfr: number; realGood: boolean; match: boolean;
  pnl: number; cumPnl: number;
  entryPrice?: number;
  exitPrice?: number;
  exitTime?: string;
  tpSlResult?: 'win' | 'loss' | 'neutral';
}

interface BacktestSummary {
  tp: number; fp: number; tn: number; fn: number;
  precision: number; recall: number; accuracy: number;
  signals: number; total: number;
  pnl: number; investment: number;
}

interface StockItem {
  symbol: string;
  price: number;
  change: number;
  volume: number;
}

const mono = "'JetBrains Mono', 'SF Mono', Menlo, Monaco, monospace";

const BACKTEST_STORAGE_KEY = 'backtest_params';

function loadBacktestParams(): Record<string, string> {
  try {
    const raw = localStorage.getItem(BACKTEST_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveBacktestParams(params: Record<string, string>) {
  try {
    localStorage.setItem(BACKTEST_STORAGE_KEY, JSON.stringify(params));
  } catch {}
}

export default function BacktestPage() {
  const [ticker, setTicker] = useState(() => loadBacktestParams().ticker ?? '');
  const [date, setDate] = useState(() => loadBacktestParams().date ?? '');
  const [fromTime, setFromTime] = useState(() => loadBacktestParams().fromTime ?? '09:30');
  const [toTime, setToTime] = useState(() => loadBacktestParams().toTime ?? '11:00');
  const [threshold, setThreshold] = useState(() => loadBacktestParams().threshold ?? '0.55');
  const [tpPct, setTpPct] = useState(() => loadBacktestParams().tpPct ?? '1.5');
  const [slPct, setSlPct] = useState(() => loadBacktestParams().slPct ?? '1');
  const [lookAhead, setLookAhead] = useState(() => loadBacktestParams().lookAhead ?? '10');
  const [investment, setInvestment] = useState(() => loadBacktestParams().investment ?? '200');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<BacktestRow[]>([]);
  const [summary, setSummary] = useState<BacktestSummary | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [stocksLoading, setStocksLoading] = useState(false);
  const [selectedRow, setSelectedRow] = useState<BacktestRow | null>(null);
  const [modalCandles, setModalCandles] = useState<Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>>([]);
  const [modalCandlesLoading, setModalCandlesLoading] = useState(false);
  const [modalCandlesError, setModalCandlesError] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);

  // Persist backtest params to localStorage for reuse
  useEffect(() => {
    saveBacktestParams({
      ticker,
      date,
      fromTime,
      toTime,
      threshold,
      tpPct,
      slPct,
      lookAhead,
      investment,
    });
  }, [ticker, date, fromTime, toTime, threshold, tpPct, slPct, lookAhead, investment]);

  // Fetch candles for trade detail popup when a tradeable row is selected
  useEffect(() => {
    if (!selectedRow || !ticker || !date) {
      setModalCandles([]);
      setModalCandlesError(false);
      return;
    }
    setModalCandlesLoading(true);
    setModalCandles([]);
    setModalCandlesError(false);
    const params = new URLSearchParams({
      ticker: ticker.toUpperCase(),
      date,
      fromTime: selectedRow.time,
      count: '12',
    });
    axios
      .get<{ candles: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }> }>(
        `/api/predict/backtest-candles?${params}`,
        { timeout: 8000 }
      )
      .then(({ data }) => {
        setModalCandles(data.candles ?? []);
        setModalCandlesError(false);
      })
      .catch(() => {
        setModalCandles([]);
        setModalCandlesError(true);
      })
      .finally(() => setModalCandlesLoading(false));
  }, [selectedRow, ticker, date]);

  const loadStocks = useCallback((d: string) => {
    if (!d) { setStocks([]); return; }
    setStocksLoading(true);
    axios.get<StockItem[]>(`/api/scanner/topmovers?date=${d}`, { timeout: 8000 })
      .then(({ data }) => setStocks(data))
      .catch(() => setStocks([]))
      .finally(() => setStocksLoading(false));
  }, []);

  // Load stocks when date changes (including initial load from storage)
  useEffect(() => {
    if (date) loadStocks(date);
  }, [date, loadStocks]);

  const handleDateChange = (d: string) => {
    setDate(d);
    setTicker('');
    setRows([]);
    setSummary(null);
    setError('');
  };

  const selectStock = (sym: string) => {
    setTicker(sym);
    setRows([]);
    setSummary(null);
    setError('');
  };

  const stopBacktest = () => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setLoading(false);
  };

  const runBacktest = () => {
    if (!ticker || !date) return;
    stopBacktest();
    setLoading(true);
    setError('');
    setRows([]);
    setSummary(null);
    setProgress({ current: 0, total: 0 });

    const params = new URLSearchParams({
      ticker: ticker.toUpperCase(),
      date,
      fromTime,
      toTime,
      threshold,
      tpPct,
      slPct,
      lookAhead: lookAhead || '10',
      investment,
    });

    const es = new EventSource(`/api/predict/backtest/stream?${params}`);
    esRef.current = es;

    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'info') {
          setProgress({ current: 0, total: msg.total });
        } else if (msg.type === 'row') {
          setRows((prev) => [...prev, msg.row]);
          setProgress((p) => ({ ...p, current: msg.progress }));
          // Auto-scroll to bottom
          requestAnimationFrame(() => {
            const el = tableContainerRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          });
        } else if (msg.type === 'summary') {
          setSummary(msg.summary);
          es.close();
          esRef.current = null;
          setLoading(false);
        } else if (msg.type === 'error') {
          setError(msg.message);
          es.close();
          esRef.current = null;
          setLoading(false);
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      if (esRef.current) {
        es.close();
        esRef.current = null;
        setLoading(false);
      }
    };
  };

  const s = summary;
  const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>

      {/* ── Left sidebar: date + stock list ── */}
      <div style={{
        width: 240, minWidth: 240,
        background: '#0f172a',
        borderRight: '1px solid #1e293b',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Date selector */}
        <div style={{ padding: '16px 14px 12px' }}>
          <label style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            Fecha
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => handleDateChange(e.target.value)}
            style={{
              width: '100%', marginTop: 6, boxSizing: 'border-box',
              background: '#1e293b', border: '1px solid #334155',
              borderRadius: 8, color: '#e2e8f0', padding: '8px 10px',
              fontSize: 13, fontFamily: mono, outline: 'none',
              colorScheme: 'dark', cursor: 'pointer',
            }}
          />
        </div>

        {/* Stock list */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '0 6px 12px',
          scrollbarWidth: 'thin', scrollbarColor: '#334155 transparent',
        }}>
          {stocksLoading && (
            <div style={{ textAlign: 'center', padding: 20, color: '#475569', fontSize: 12 }}>
              Cargando…
            </div>
          )}
          {!stocksLoading && date && stocks.length === 0 && (
            <div style={{ textAlign: 'center', padding: 20, color: '#475569', fontSize: 12 }}>
              Sin datos para esta fecha
            </div>
          )}
          {stocks.map((st) => {
            const active = st.symbol === ticker;
            const chgColor = st.change >= 0 ? '#22c55e' : '#ef4444';
            return (
              <button
                key={st.symbol}
                onClick={() => selectStock(st.symbol)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '8px 10px', marginBottom: 2,
                  background: active ? 'rgba(59,130,246,0.12)' : 'transparent',
                  border: active ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent',
                  borderRadius: 8, cursor: 'pointer',
                  transition: 'all 0.1s',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 700, fontFamily: mono,
                    color: active ? '#60a5fa' : '#e2e8f0',
                  }}>
                    {st.symbol}
                  </span>
                  <span style={{ fontSize: 10, color: '#475569' }}>
                    Vol {st.volume >= 1_000_000 ? `${(st.volume / 1_000_000).toFixed(1)}M` : `${(st.volume / 1000).toFixed(0)}K`}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  <span style={{ fontSize: 12, fontFamily: mono, color: '#94a3b8' }}>
                    ${st.price.toFixed(2)}
                  </span>
                  <span style={{
                    fontSize: 11, fontFamily: mono, fontWeight: 600, color: chgColor,
                    background: `${chgColor}15`, padding: '1px 6px', borderRadius: 4,
                  }}>
                    {fmtPct(st.change)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Config bar */}
        <div style={{
          display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap',
          padding: '12px 20px',
          background: '#0f172a', borderBottom: '1px solid #1e293b',
        }}>
          <Field label="Ticker" width={90}>
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="EPSM"
              style={{ ...inputStyle, textTransform: 'uppercase', fontWeight: 700, fontSize: 14 }}
            />
          </Field>
          <Field label="Desde" width={72}>
            <input value={fromTime} onChange={(e) => setFromTime(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Hasta" width={72}>
            <input value={toTime} onChange={(e) => setToTime(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Threshold" width={60}>
            <input value={threshold} onChange={(e) => setThreshold(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="TP %" width={50}>
            <input value={tpPct} onChange={(e) => setTpPct(e.target.value)} placeholder="1.5" style={inputStyle} />
          </Field>
          <Field label="SL %" width={50}>
            <input value={slPct} onChange={(e) => setSlPct(e.target.value)} placeholder="1.5" style={inputStyle} />
          </Field>
          <Field label="Velas adelante" width={90}>
            <input
              value={lookAhead}
              onChange={(e) => setLookAhead(e.target.value.replace(/\D/g, '').slice(0, 2) || '')}
              placeholder="10"
              style={inputStyle}
            />
          </Field>
          <Field label="Inversión $" width={70}>
            <input value={investment} onChange={(e) => setInvestment(e.target.value)} style={inputStyle} />
          </Field>
          <button
            onClick={loading ? stopBacktest : runBacktest}
            disabled={!loading && (!ticker || !date)}
            style={{
              padding: '8px 22px', marginLeft: 4,
              background: loading ? '#dc2626' : 'linear-gradient(135deg, #2563eb, #7c3aed)',
              color: (!loading && (!ticker || !date)) ? '#475569' : '#fff',
              border: 'none', borderRadius: 8,
              cursor: (!loading && (!ticker || !date)) ? 'not-allowed' : 'pointer',
              fontWeight: 700, fontSize: 13, fontFamily: mono,
              letterSpacing: '0.03em',
              boxShadow: loading ? '0 2px 8px rgba(220,38,38,0.3)' : '0 2px 8px rgba(37,99,235,0.3)',
              transition: 'all 0.15s',
            }}
          >
            {loading ? '⏹ Stop' : '▶ Run Backtest'}
          </button>
          {loading && progress.total > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
              <div style={{
                width: 120, height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden',
              }}>
                <div style={{
                  width: `${(progress.current / progress.total) * 100}%`,
                  height: '100%', background: '#3b82f6', borderRadius: 3,
                  transition: 'width 0.2s',
                }} />
              </div>
              <span style={{ fontSize: 11, color: '#64748b', fontFamily: mono }}>
                {progress.current}/{progress.total}
              </span>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{
            margin: '12px 20px 0', padding: '10px 14px',
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 8, color: '#fca5a5', fontSize: 13,
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* Summary cards */}
        {s && (
          <div style={{
            display: 'flex', gap: 8, padding: '14px 20px 6px', flexWrap: 'wrap',
          }}>
            <SummaryCard label="Precision" value={`${s.precision}%`} color="#3b82f6" />
            <SummaryCard label="Recall" value={`${s.recall}%`} color="#8b5cf6" />
            <SummaryCard label="Accuracy" value={`${s.accuracy}%`} color="#06b6d4" />
            <SummaryCard label="Signals" value={`${s.signals}/${s.total}`} color="#64748b" />
            <div style={{
              display: 'flex', gap: 6, padding: '6px 12px',
              background: '#111827', borderRadius: 8, border: '1px solid #1e293b',
              alignItems: 'center', fontSize: 12, fontFamily: mono,
            }}>
              <span style={{ color: '#22c55e' }}>TP {s.tp}</span>
              <span style={{ color: '#334155' }}>|</span>
              <span style={{ color: '#ef4444' }}>FP {s.fp}</span>
              <span style={{ color: '#334155' }}>|</span>
              <span style={{ color: '#94a3b8' }}>TN {s.tn}</span>
              <span style={{ color: '#334155' }}>|</span>
              <span style={{ color: '#f59e0b' }}>FN {s.fn}</span>
            </div>
            <div style={{
              padding: '6px 14px',
              background: s.pnl >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              border: `1px solid ${s.pnl >= 0 ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
              borderRadius: 8, fontSize: 13, fontFamily: mono, fontWeight: 700,
              color: s.pnl >= 0 ? '#4ade80' : '#f87171',
            }}>
              P/L {s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)}
              <span style={{ fontSize: 10, color: '#475569', marginLeft: 6 }}>(${s.investment}/trade)</span>
            </div>
          </div>
        )}

        {/* Reporte de Wins (TP/SL) */}
        {rows.length > 0 && (() => {
          const wins = rows.filter((r) => r.tradeable && r.tpSlResult === 'win').length;
          const losses = rows.filter((r) => r.tradeable && r.tpSlResult === 'loss').length;
          const neutrals = rows.filter((r) => r.tradeable && r.tpSlResult === 'neutral').length;
          const totalTraded = wins + losses + neutrals;
          const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '—';
          return (
            <div style={{
              display: 'flex', gap: 8, padding: '0 20px 14px', flexWrap: 'wrap',
              borderBottom: '1px solid #1e293b',
            }}>
              <span style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, alignSelf: 'center' }}>
                Reporte de Wins
              </span>
              <div style={{
                display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, fontFamily: mono,
                padding: '6px 12px', background: '#111827', borderRadius: 8, border: '1px solid #1e293b',
              }}>
                <span style={{ color: '#22c55e', fontWeight: 600 }}>Wins {wins}</span>
                <span style={{ color: '#334155' }}>|</span>
                <span style={{ color: '#ef4444', fontWeight: 600 }}>Losses {losses}</span>
                <span style={{ color: '#334155' }}>|</span>
                <span style={{ color: '#64748b' }}>Neutrals {neutrals}</span>
                <span style={{ color: '#334155' }}>|</span>
                <span style={{ color: '#3b82f6', fontWeight: 700 }}>Win rate {winRate}%</span>
                <span style={{ fontSize: 10, color: '#475569', marginLeft: 4 }}>
                  ({totalTraded} operaciones)
                </span>
              </div>
            </div>
          );
        })()}

        {/* Results table */}
        <div ref={tableContainerRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 20px 20px' }}>
          {rows.length > 0 ? (
            <table style={{
              borderCollapse: 'collapse', width: '100%',
              fontSize: 12, fontFamily: mono,
            }}>
              <thead>
                <tr>
                  {['Time', 'Open', 'High', 'Low', 'Close', 'Vol', 'Prob', 'Trade', `MFR${lookAhead || '10'}m`, 'Real', 'TP/SL', 'Match', 'Entrada', 'Salida', 'Vela Salida', 'P/L', 'Cumul'].map((h) => (
                    <th key={h} style={{
                      padding: '8px 8px', textAlign: 'right', color: '#475569',
                      fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      borderBottom: '2px solid #1e293b',
                      position: 'sticky', top: 0, background: '#0f172a', zIndex: 1,
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isSignal = r.tradeable;
                  return (
                    <tr
                      key={i}
                      onClick={() => isSignal && setSelectedRow(r)}
                      style={{
                        borderBottom: '1px solid #111827',
                        background: isSignal
                          ? (r.match ? 'rgba(34,197,94,0.04)' : 'rgba(239,68,68,0.04)')
                          : 'transparent',
                        cursor: isSignal ? 'pointer' : 'default',
                      }}
                    >
                      <td style={cs}>{r.time}</td>
                      <td style={cs}>{r.open.toFixed(3)}</td>
                      <td style={cs}>{r.high.toFixed(3)}</td>
                      <td style={cs}>{r.low.toFixed(3)}</td>
                      <td style={cs}>{r.close.toFixed(3)}</td>
                      <td style={cs}>{r.volume.toLocaleString()}</td>
                      <td style={{
                        ...cs, fontWeight: 700,
                        color: r.prob >= parseFloat(threshold) ? '#22c55e' : r.prob >= parseFloat(threshold) - 0.2 ? '#f59e0b' : '#475569',
                      }}>
                        {r.prob.toFixed(4)}
                      </td>
                      <td style={{ ...cs, textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                          background: r.tradeable ? '#22c55e' : '#334155',
                        }} />
                      </td>
                      <td style={{
                        ...cs,
                        color: r.mfr >= 0.015 ? '#22c55e' : r.mfr >= 0 ? '#64748b' : '#ef4444',
                      }}>
                        {(r.mfr * 100).toFixed(2)}%
                      </td>
                      <td style={{ ...cs, textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                          background: r.realGood ? '#22c55e' : '#334155',
                        }} />
                      </td>
                      <td style={{ ...cs, textAlign: 'center' }}>
                        {isSignal && r.tpSlResult ? (
                          <span style={{
                            fontSize: 11, fontWeight: 700,
                            color: r.tpSlResult === 'win' ? '#22c55e' : r.tpSlResult === 'loss' ? '#ef4444' : '#64748b',
                          }}>
                            {r.tpSlResult === 'win' ? 'win' : r.tpSlResult === 'loss' ? 'loss' : '—'}
                          </span>
                        ) : <span style={{ color: '#1e293b' }}>—</span>}
                      </td>
                      <td style={{ ...cs, textAlign: 'center' }}>
                        {isSignal ? (
                          <span style={{
                            fontSize: 11, fontWeight: 700,
                            color: r.match ? '#22c55e' : '#ef4444',
                          }}>
                            {r.match ? '✓' : '✗'}
                          </span>
                        ) : <span style={{ color: '#1e293b' }}>—</span>}
                      </td>
                      <td style={cs}>
                        {isSignal && r.entryPrice != null ? r.entryPrice.toFixed(3) : '—'}
                      </td>
                      <td style={cs}>
                        {isSignal && r.exitPrice != null ? r.exitPrice.toFixed(3) : '—'}
                      </td>
                      <td style={cs}>
                        {isSignal && r.exitTime ? r.exitTime : '—'}
                      </td>
                      <td style={{
                        ...cs,
                        color: r.pnl > 0 ? '#22c55e' : r.pnl < 0 ? '#ef4444' : '#1e293b',
                        fontWeight: r.pnl !== 0 ? 600 : 400,
                      }}>
                        {r.pnl !== 0 ? `${r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(2)}` : '—'}
                      </td>
                      <td style={{
                        ...cs, fontWeight: 700,
                        color: r.cumPnl > 0 ? '#22c55e' : r.cumPnl < 0 ? '#ef4444' : '#475569',
                      }}>
                        {r.cumPnl >= 0 ? '+' : ''}{r.cumPnl.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : !loading && !error && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: '100%', gap: 12, color: '#334155',
            }}>
              <span style={{ fontSize: 48 }}>🔮</span>
              <span style={{ fontSize: 14 }}>
                {!date ? 'Selecciona una fecha para comenzar' : !ticker ? 'Selecciona un stock de la lista' : 'Presiona Run Backtest'}
              </span>
            </div>
          )}

          {loading && rows.length === 0 && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: '60%', gap: 16, color: '#64748b',
            }}>
              <div style={{
                width: 32, height: 32, border: '3px solid #1e293b',
                borderTop: '3px solid #3b82f6', borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
              <span style={{ fontSize: 13 }}>
                Cargando datos de <strong style={{ color: '#e2e8f0' }}>{ticker}</strong>…
              </span>
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            </div>
          )}
        </div>
      </div>

      {/* Trade detail popup */}
      {selectedRow && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.6)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setSelectedRow(null)}
        >
          <div
            style={{
              background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b',
              minWidth: 420, maxWidth: '90vw', maxHeight: '85vh', overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 18px', borderBottom: '1px solid #1e293b',
            }}>
              <span style={{ fontSize: 14, fontWeight: 700, fontFamily: mono, color: '#e2e8f0' }}>
                {ticker} @ {selectedRow.time}
                {selectedRow.entryPrice != null && ` – Entrada $${selectedRow.entryPrice.toFixed(3)}`}
                {selectedRow.exitPrice != null && ` → Salida $${selectedRow.exitPrice.toFixed(3)}`}
              </span>
              <button
                onClick={() => setSelectedRow(null)}
                style={{
                  background: 'transparent', border: 'none', color: '#94a3b8',
                  cursor: 'pointer', fontSize: 18, padding: '2px 8px', lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: 16, flex: 1, minHeight: 280 }}>
              {modalCandlesLoading ? (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', height: 280, gap: 12, color: '#64748b',
                }}>
                  <div style={{
                    width: 28, height: 28, border: '2px solid #1e293b',
                    borderTop: '2px solid #3b82f6', borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  <span style={{ fontSize: 12 }}>Cargando velas…</span>
                  <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
                </div>
              ) : !modalCandles.length ? (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  height: 280, color: '#64748b', fontSize: 13, gap: 6,
                }}>
                  {modalCandlesError ? (
                    <>
                      <span>Error al cargar. ¿Backend en puerto 3033?</span>
                      <span style={{ fontSize: 11 }}>GET /predict/backtest-candles</span>
                    </>
                  ) : (
                    'Sin datos para esta vela'
                  )}
                </div>
              ) : (
                <TradeDetailChart
                  candles={modalCandles}
                  entryPrice={selectedRow.entryPrice ?? selectedRow.close}
                  exitPrice={selectedRow.exitPrice}
                  exitTime={selectedRow.exitTime}
                  height={280}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Tiny sub-components ── */

function Field({ label, width, children }: { label: string; width: number; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width }}>
      <label style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      padding: '6px 14px',
      background: '#111827', borderRadius: 8,
      border: '1px solid #1e293b',
    }}>
      <div style={{ fontSize: 10, color: '#475569', marginBottom: 2 }}>{label}</div>
      <div style={{
        fontSize: 15, fontWeight: 700,
        fontFamily: "'JetBrains Mono', monospace",
        color,
      }}>{value}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  background: '#1e293b', border: '1px solid #334155',
  borderRadius: 6, color: '#e2e8f0', padding: '7px 10px',
  fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
  outline: 'none',
};

const cs: React.CSSProperties = {
  padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap',
};
