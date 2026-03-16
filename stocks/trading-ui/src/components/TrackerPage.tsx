import { useState, useEffect } from 'react';
import axios from 'axios';

export interface ScannedSymbolData {
  symbol: string;
  passes_pre_filter: boolean;
  float_shares: number | null;
  outstanding_shares: number | null;
  free_float: number | null;
  catalyst_strength: string | null;
  catalyst_type: string | null;
  premarket_volume: number | null;
  premarket_dollar_volume: number | null;
  volume: number | null;
  dollar_volume: number | null;
  close: number | null;
  ema9: number | null;
  gap_pct: number | null;
  arrived_at: string;
  updated_at: string;
}

export default function TrackerPage() {
  const [symbols, setSymbols] = useState<ScannedSymbolData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTrackerData = async () => {
    try {
      const { data } = await axios.get<ScannedSymbolData[]>('/api/scanner-tracker/today');
      setSymbols(data);
    } catch (err) {
      console.error('Failed to fetch tracker data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrackerData();
    // Auto refresh every minute
    const interval = setInterval(fetchTrackerData, 60000);
    return () => clearInterval(interval);
  }, []);

  const formatNumber = (num: number | null) => {
    if (num === null || isNaN(num)) return '-';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(2);
  };

  const formatCurrency = (num: number | null) => {
    if (num === null || isNaN(num)) return '-';
    return '$' + formatNumber(num);
  };

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false });
    } catch {
      return '-';
    }
  };

  const isFloatUnder20M = (freeFloat: number | null, floatShares: number | null) => {
    if (floatShares !== null) {
      return floatShares < 20_000_000;
    }
    return false; // Free float percentage needs outstanding shares to calculate absolute, defaulting to false if we don't have absolute
  };

  return (
    <div style={{ padding: '24px', flex: 1, overflowY: 'auto' }}>
      <h2 style={{ color: '#e2e8f0', margin: '0 0 20px 0', fontFamily: "'JetBrains Mono', monospace" }}>
        Scanner Tracker (Today)
      </h2>
      
      {loading && symbols.length === 0 ? (
        <div style={{ color: '#64748b' }}>Cargando datos...</div>
      ) : symbols.length === 0 ? (
        <div style={{ color: '#64748b' }}>No se han rastreado símbolos hoy.</div>
      ) : (
        <div style={{
          overflowX: 'auto',
          background: '#131820',
          border: '1px solid #232d3f',
          borderRadius: 8
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
            <thead>
              <tr style={{ background: '#1a2030', color: '#94a3b8', textAlign: 'left' }}>
                <th style={thStyle}>Symbol</th>
                <th style={thStyle}>Arrived (ET)</th>
                <th style={thStyle}>Passes PreFilter</th>
                <th style={thStyle}>Price</th>
                <th style={thStyle}>Float Check (&lt;20M)</th>
                <th style={thStyle}>Float Shares</th>
                <th style={thStyle}>PM Vol</th>
                <th style={thStyle}>Gap %</th>
                <th style={thStyle}>Catalyst</th>
              </tr>
            </thead>
            <tbody>
              {symbols.map((sym) => {
                const preFilterColor = sym.passes_pre_filter ? '#22c55e' : '#ef4444';
                const floatCheck = isFloatUnder20M(sym.free_float, sym.float_shares);
                const floatColor = floatCheck ? '#22c55e' : '#ef4444';
                
                return (
                  <tr key={sym.symbol} style={{ borderBottom: '1px solid #232d3f' }}>
                    <td style={{ ...tdStyle, fontWeight: 'bold', color: '#e2e8f0' }}>{sym.symbol}</td>
                    <td style={{ ...tdStyle, color: '#94a3b8' }}>{formatTime(sym.arrived_at)}</td>
                    <td style={{ ...tdStyle, color: preFilterColor }}>
                      <span style={badgeStyle(sym.passes_pre_filter ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', preFilterColor)}>
                        {sym.passes_pre_filter ? 'YES' : 'NO'}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: '#e2e8f0' }}>{formatCurrency(sym.close)}</td>
                    <td style={{ ...tdStyle, color: floatColor }}>
                      <span style={badgeStyle(floatCheck ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', floatColor)}>
                        {floatCheck ? 'YES' : 'NO'}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: '#e2e8f0' }}>{formatNumber(sym.float_shares)}</td>
                    <td style={{ ...tdStyle, color: '#e2e8f0' }}>{formatNumber(sym.premarket_volume)}</td>
                    <td style={{ ...tdStyle, color: (sym.gap_pct ?? 0) >= 10 ? '#22c55e' : '#eab308' }}>
                      {sym.gap_pct !== null ? `${sym.gap_pct.toFixed(2)}%` : '-'}
                    </td>
                    <td style={{ ...tdStyle, color: '#e2e8f0', fontSize: 12 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {sym.catalyst_strength && (
                          <span style={badgeStyle(
                            sym.catalyst_strength === 'STRONG' ? 'rgba(34,197,94,0.15)' : 
                            sym.catalyst_strength === 'MODERATE' ? 'rgba(234,179,8,0.15)' : 
                            sym.catalyst_strength === 'WEAK' ? 'rgba(239,68,68,0.15)' : 'rgba(100,116,139,0.15)',
                            sym.catalyst_strength === 'STRONG' ? '#22c55e' : 
                            sym.catalyst_strength === 'MODERATE' ? '#eab308' : 
                            sym.catalyst_strength === 'WEAK' ? '#ef4444' : '#94a3b8'
                          )}>
                            {sym.catalyst_strength}
                          </span>
                        )}
                        <span style={{ color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }} title={sym.catalyst_type || ''}>
                          {sym.catalyst_type || 'No news'}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid #232d3f',
  fontWeight: 600,
  whiteSpace: 'nowrap'
};

const tdStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid #232d3f',
};

const badgeStyle = (bg: string, color: string): React.CSSProperties => ({
  background: bg,
  color: color,
  padding: '2px 8px',
  borderRadius: '4px',
  fontWeight: 'bold',
  fontSize: '11px',
  display: 'inline-block'
});
