/** Panel de historial de análisis para debug — muestra lo enviado al modelo y las respuestas. */

import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

export interface LogEntry {
  id: number;
  ticker: string;
  account_size: number;
  cutoff_ms: number | null;
  request_prompt: string;
  messages_json: string;
  response_json: string;
  raw_analysis: string;
  tool_calls_count: number;
  rag_chunks_used: number;
  duration_ms: number;
  error_text: string | null;
  created_at: string;
}

interface Props {
  onClose: () => void;
}

export default function LogsPanel({ onClose }: Props) {
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
      <LogsPanelInner onClose={onClose} />
    </div>
  );
}

function LogsPanelInner({ onClose }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [tickerFilter, setTickerFilter] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let url = '/api/agent/logs?limit=50';
    if (tickerFilter.trim()) url += `&ticker=${encodeURIComponent(tickerFilter.trim())}`;
    setLoading(true);
    axios.get<LogEntry[]>(url)
      .then(({ data }) => setLogs(data))
      .catch((e) => setError(e?.response?.data?.message || e.message || 'Error cargando logs'))
      .finally(() => setLoading(false));
  }, [tickerFilter]);

  return (
    <div
      style={{
        background: '#0f1520',
        border: '1px solid #2d3f55',
        borderRadius: 12,
        maxWidth: 900,
        maxHeight: '90vh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
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
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>📋 Historial de Análisis (Debug)</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            placeholder="Filtrar por ticker…"
            value={tickerFilter}
            onChange={(e) => setTickerFilter(e.target.value.toUpperCase())}
            style={{
              width: 140,
              padding: '6px 10px',
              background: '#1a2030',
              border: '1px solid #2d3f55',
              borderRadius: 6,
              color: '#e2e8f0',
              fontSize: 12,
            }}
          />
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
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div style={{
          width: 280,
          borderRight: '1px solid #232d3f',
          overflowY: 'auto',
          padding: 12,
        }}>
          {error && (
            <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>{error}</div>
          )}
          {loading && (
            <div style={{ color: '#64748b', fontSize: 13 }}>Cargando…</div>
          )}
          {!loading && logs.length === 0 && (
            <div style={{ color: '#64748b', fontSize: 13 }}>
              No hay logs. Ejecuta un análisis para guardar.
            </div>
          )}
          {!loading && logs.map((log) => (
            <button
              key={log.id}
              onClick={() => setSelected(log)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '10px 12px',
                marginBottom: 8,
                background: selected?.id === log.id ? '#1e3a5f' : '#1a2030',
                border: `1px solid ${selected?.id === log.id ? '#3b82f6' : '#232d3f'}`,
                borderRadius: 8,
                color: '#e2e8f0',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 700 }}>{log.ticker}</div>
              <div style={{ color: '#64748b', fontSize: 11 }}>
                {new Date(log.created_at).toLocaleString()} · {log.duration_ms}ms · {log.tool_calls_count} tools
              </div>
            </button>
          ))}
        </div>

        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: 16,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
        }}>
          {selected ? (
            <LogDetail log={selected} />
          ) : (
            <div style={{ color: '#64748b' }}>Selecciona un log</div>
          )}
        </div>
      </div>
    </div>
  );
}

function LogDetail({ log }: { log: LogEntry }) {
  const [activeTab, setActiveTab] = useState<'response' | 'messages' | 'raw'>('response');
  const response = useMemo(() => {
    try { return JSON.parse(log.response_json); } catch { return null; }
  }, [log.response_json]);
  const messages = useMemo(() => {
    try { return JSON.parse(log.messages_json); } catch { return []; }
  }, [log.messages_json]);

  return (
    <div>
      <div style={{ marginBottom: 16, color: '#94a3b8' }}>
        <strong>{log.ticker}</strong> · ${log.account_size.toLocaleString()}
        {log.cutoff_ms && ` · Replay hasta ${new Date(log.cutoff_ms).toLocaleString()}`}
        <br />
        {log.duration_ms}ms · {log.tool_calls_count} tool calls · {log.rag_chunks_used} RAG chunks
      </div>
      {log.error_text && (
        <div style={{
          padding: 10,
          background: 'rgba(239,68,68,0.15)',
          border: '1px solid rgba(239,68,68,0.4)',
          borderRadius: 8,
          marginBottom: 12,
          fontSize: 12,
          color: '#fca5a5',
        }}>
          Error: {log.error_text}
        </div>
      )}
      {log.request_prompt && (
        <div style={{
          padding: 10,
          background: '#1a2030',
          borderRadius: 8,
          border: '1px solid #232d3f',
          marginBottom: 12,
          fontSize: 12,
          color: '#cbd5e1',
        }}>
          <span style={{ color: '#64748b' }}>Request: </span>{log.request_prompt}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['response', 'messages', 'raw'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={{
              padding: '6px 12px',
              background: activeTab === t ? '#1e3a5f' : '#1a2030',
              border: `1px solid ${activeTab === t ? '#3b82f6' : '#232d3f'}`,
              borderRadius: 6,
              color: activeTab === t ? '#93c5fd' : '#94a3b8',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            {t === 'response' ? 'Respuesta' : t === 'messages' ? 'Conversación' : 'Raw'}
          </button>
        ))}
      </div>

      {activeTab === 'response' && (
        <pre style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: '#cbd5e1',
          background: '#131820',
          padding: 16,
          borderRadius: 8,
          border: '1px solid #232d3f',
          maxHeight: 400,
          overflowY: 'auto',
        }}>
          {response ? JSON.stringify(response, null, 2) : log.response_json}
        </pre>
      )}

      {activeTab === 'messages' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.map((m: any, i: number) => (
            <div
              key={i}
              style={{
                padding: 12,
                background: m.type === 'human' ? '#1a2e1a' : m.type === 'ai' ? '#1a2a3a' : '#2a1a2a',
                borderRadius: 8,
                border: '1px solid #232d3f',
              }}
            >
              <div style={{ color: '#64748b', fontSize: 10, marginBottom: 6 }}>
                {m.type?.toUpperCase?.() ?? 'unknown'} {m.tool_calls?.length ? `(${m.tool_calls.length} tool calls)` : ''}
              </div>
              <pre style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: '#cbd5e1',
                fontSize: 11,
                maxHeight: 200,
                overflowY: 'auto',
              }}>
                {m.content?.slice?.(0, 5000)}{m.content?.length > 5000 ? '\n...[truncated]' : ''}
              </pre>
              {m.tool_calls?.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ color: '#64748b', cursor: 'pointer' }}>Tool calls</summary>
                  <pre style={{
                    marginTop: 6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: '#94a3b8',
                    fontSize: 10,
                  }}>
                    {JSON.stringify(m.tool_calls, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'raw' && (
        <pre style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: '#cbd5e1',
          background: '#131820',
          padding: 16,
          borderRadius: 8,
          border: '1px solid #232d3f',
          maxHeight: 400,
          overflowY: 'auto',
        }}>
          {log.raw_analysis}
        </pre>
      )}
    </div>
  );
}
