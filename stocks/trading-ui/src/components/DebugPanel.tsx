/** Debug panel — Alpaca WebSocket status, active symbols, subscriptions, positions. */

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

interface DebugStreamsResponse {
  alpaca: { connected: boolean; subscriptions: string[]; source: string };
  momo: { connected: boolean; subscriptions: string[]; source: string };
  activeSymbols: string[];
  primaryStream: string;
  positions: Array<{
    id: number;
    symbol: string;
    entry_time: string;
    entry_price: number;
    qty: number;
    entry_candle_idx: number;
    candles_elapsed: number;
    alpaca_order_id: string;
  }>;
  lastBarTimes: Record<string, number>;
}

interface Props {
  onClose: () => void;
}

export default function DebugPanel({ onClose }: Props) {
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
      <DebugPanelInner onClose={onClose} />
    </div>
  );
}

function DebugPanelInner({ onClose }: Props) {
  const [data, setData] = useState<DebugStreamsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resyncLoading, setResyncLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const { data: res } = await axios.get<DebugStreamsResponse>('/api/collector/debug-streams');
      setData(res);
      setError('');
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'response' in e
        ? (e as { response?: { data?: { message?: string } } }).response?.data?.message
        : e instanceof Error ? e.message : 'Error loading debug data';
      setError(String(msg));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleForceResync = async () => {
    setResyncLoading(true);
    try {
      await axios.post<{ ok: boolean; resubscribed: string[] }>('/api/collector/force-resync');
      await fetchData();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Force resync failed';
      setError(String(msg));
    } finally {
      setResyncLoading(false);
    }
  };

  const activeSet = new Set(data?.activeSymbols ?? []);
  const subSet = new Set(data?.alpaca?.subscriptions ?? []);
  const missingInSubs = data?.activeSymbols?.filter((s) => !subSet.has(s)) ?? [];
  const extraInSubs = data?.alpaca?.subscriptions?.filter((s) => !activeSet.has(s)) ?? [];
  const hasDrift = missingInSubs.length > 0 || extraInSubs.length > 0;

  const formatTs = (sec: number) => new Date(sec * 1000).toISOString().replace('T', ' ').slice(0, 19);

  return (
    <div
      style={{
        background: '#0f1520',
        border: '1px solid #2d3f55',
        borderRadius: 12,
        maxWidth: 700,
        maxHeight: '90vh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
        overflow: 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid #232d3f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>🔧 Debug</span>
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

      <div style={{ padding: 20, overflowY: 'auto', fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
        {error && (
          <div style={{
            padding: 12,
            background: 'rgba(239,68,68,0.15)',
            border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: 8,
            marginBottom: 16,
            color: '#fca5a5',
            fontSize: 12,
          }}>
            {error}
          </div>
        )}

        {loading && !data ? (
          <div style={{ color: '#64748b' }}>Cargando…</div>
        ) : data ? (
          <>
            {/* Alpaca WebSocket status */}
            <Section title="Alpaca WebSocket">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    fontWeight: 700,
                    background: data.alpaca.connected ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                    border: `1px solid ${data.alpaca.connected ? '#22c55e' : '#ef4444'}`,
                    color: data.alpaca.connected ? '#4ade80' : '#f87171',
                  }}
                >
                  {data.alpaca.connected ? 'Connected' : 'Disconnected'}
                </span>
                <span style={{ color: '#64748b', fontSize: 12 }}>{data.alpaca.source}</span>
              </div>
            </Section>

            {/* Drift warning */}
            {hasDrift && (
              <Section title="⚠️ Subscription drift">
                <div style={{
                  padding: 12,
                  background: 'rgba(245,158,11,0.1)',
                  border: '1px solid rgba(245,158,11,0.4)',
                  borderRadius: 8,
                  color: '#fbbf24',
                  fontSize: 12,
                }}>
                  {missingInSubs.length > 0 && (
                    <div>Active but not subscribed: {missingInSubs.join(', ') || '—'}</div>
                  )}
                  {extraInSubs.length > 0 && (
                    <div>Subscribed but not active: {extraInSubs.join(', ') || '—'}</div>
                  )}
                </div>
              </Section>
            )}

            {/* Active symbols */}
            <Section title="Active symbols">
              <div style={{ color: '#94a3b8' }}>
                {data.activeSymbols.length} symbols: {data.activeSymbols.join(', ') || '—'}
              </div>
            </Section>

            {/* Alpaca subscriptions */}
            <Section title="Alpaca subscriptions">
              <div style={{ color: '#94a3b8' }}>
                {data.alpaca.subscriptions.length} symbols: {data.alpaca.subscriptions.join(', ') || '—'}
              </div>
            </Section>

            {/* Last bar times */}
            {Object.keys(data.lastBarTimes ?? {}).length > 0 && (
              <Section title="Last bar times">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {Object.entries(data.lastBarTimes)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([sym, sec]) => (
                      <div key={sym} style={{ color: '#94a3b8', fontSize: 11 }}>
                        {sym}: {formatTs(sec)}
                      </div>
                    ))}
                </div>
              </Section>
            )}

            {/* Open positions */}
            <Section title="Open positions">
              {data.positions.length === 0 ? (
                <div style={{ color: '#64748b' }}>No open positions</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #232d3f' }}>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: '#64748b' }}>Symbol</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px', color: '#64748b' }}>Entry</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px', color: '#64748b' }}>Qty</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px', color: '#64748b' }}>Candles</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: '#64748b' }}>Entry time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.positions.map((p) => (
                        <tr key={p.id} style={{ borderBottom: '1px solid #1e293b' }}>
                          <td style={{ padding: '6px 8px', color: '#e2e8f0', fontWeight: 600 }}>{p.symbol}</td>
                          <td style={{ padding: '6px 8px', color: '#94a3b8', textAlign: 'right' }}>${p.entry_price.toFixed(2)}</td>
                          <td style={{ padding: '6px 8px', color: '#94a3b8', textAlign: 'right' }}>{p.qty}</td>
                          <td style={{ padding: '6px 8px', color: '#94a3b8', textAlign: 'right' }}>{p.candles_elapsed}</td>
                          <td style={{ padding: '6px 8px', color: '#64748b', fontSize: 10 }}>{p.entry_time}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* Actions */}
            <Section title="Actions">
              <button
                onClick={handleForceResync}
                disabled={resyncLoading || !data.alpaca.connected}
                style={{
                  padding: '8px 16px',
                  background: resyncLoading || !data.alpaca.connected ? '#1e293b' : 'rgba(59,130,246,0.2)',
                  border: `1px solid ${resyncLoading || !data.alpaca.connected ? '#334155' : 'rgba(59,130,246,0.5)'}`,
                  borderRadius: 8,
                  color: resyncLoading || !data.alpaca.connected ? '#64748b' : '#60a5fa',
                  cursor: resyncLoading || !data.alpaca.connected ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {resyncLoading ? 'Resyncing…' : 'Force Resync'}
              </button>
            </Section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontSize: 11,
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: 8,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}
