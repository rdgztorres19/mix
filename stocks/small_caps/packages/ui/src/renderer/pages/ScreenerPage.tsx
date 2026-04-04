import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScreenerStore } from '../stores/screener.store';
import { Search, Loader2 } from 'lucide-react';

export function ScreenerPage() {
  const { date, dates, results, loading, setDate, fetchDates, fetchResults } = useScreenerStore();
  const navigate = useNavigate();

  useEffect(() => {
    fetchDates();
  }, []);

  useEffect(() => {
    if (date) fetchResults();
  }, [date]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-slate-100">Daily Screener</h1>
        <div className="flex items-center gap-3">
          <label className="text-sm text-slate-400">Date:</label>
          <select
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-emerald-500 focus:border-emerald-500"
          >
            {dates.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="animate-spin text-emerald-400" size={32} />
        </div>
      ) : (
        <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left py-3 px-4 text-slate-400 font-medium">#</th>
                <th className="text-left py-3 px-4 text-slate-400 font-medium">Symbol</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium">Gap %</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium">Change %</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium">Volume</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium">Prev Close</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium">Open</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium">Close</th>
                <th className="text-left py-3 px-4 text-slate-400 font-medium">Rank Types</th>
              </tr>
            </thead>
            <tbody>
              {results.map((row) => (
                <tr
                  key={row.symbol}
                  onClick={() => navigate(`/chart/${row.symbol}/${date}`)}
                  className="border-b border-slate-800/50 hover:bg-slate-800/50 cursor-pointer transition-colors"
                >
                  <td className="py-2.5 px-4 text-slate-500">{row.rank}</td>
                  <td className="py-2.5 px-4 font-semibold text-slate-100">{row.symbol}</td>
                  <td className={`py-2.5 px-4 text-right font-mono ${row.gapPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {row.gapPct >= 0 ? '+' : ''}{row.gapPct.toFixed(1)}%
                  </td>
                  <td className={`py-2.5 px-4 text-right font-mono ${row.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {row.changePct >= 0 ? '+' : ''}{row.changePct.toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-300">
                    {formatVolume(row.volume)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-400">
                    ${row.previousClose.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-300">
                    ${row.open.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-300">
                    ${row.close.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex gap-1 flex-wrap">
                      {row.rankTypes.map((t) => (
                        <RankBadge key={t} type={t} />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.length === 0 && !loading && (
            <div className="flex items-center justify-center h-32 text-slate-500">
              <Search size={20} className="mr-2" />
              Select a date to view screener results
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RankBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    gapper: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
    gainer_session: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    gainer_intraday: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    high_session: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    high_current: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  };
  const labels: Record<string, string> = {
    gapper: 'GAP',
    gainer_session: 'GAIN_S',
    gainer_intraday: 'GAIN_I',
    high_session: 'HOD_S',
    high_current: 'HOD_C',
  };
  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${colors[type] ?? 'bg-slate-700 text-slate-400 border-slate-600'}`}>
      {labels[type] ?? type}
    </span>
  );
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toString();
}
