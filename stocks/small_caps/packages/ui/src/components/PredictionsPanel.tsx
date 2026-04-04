import type { PredictionBundle, ModelPrediction, PredictionCategory } from '@small-caps/shared';

interface Props {
  bundle: PredictionBundle | null;
  loading: boolean;
}

function probColor(p: ModelPrediction): string {
  if (p.error) return 'bg-gray-500/20 text-gray-400 border-gray-500/40';
  if (p.tradeable) return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50';
  if (p.prob >= 0.5) return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
  return 'bg-slate-700/40 text-slate-400 border-slate-600/40';
}

function Row({ label, items }: { label: string; items: ModelPrediction[] }) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      <div className="w-8 shrink-0 text-[9px] font-semibold uppercase text-muted-foreground tracking-wider">{label}</div>
      <div className="flex-1 flex gap-0.5 min-w-0">
        {items.length === 0 ? (
          <span className="text-[10px] text-muted-foreground">—</span>
        ) : (
          items.map((p) => (
            <div
              key={p.modelKey}
              title={`${p.label} • p=${p.prob.toFixed(3)} • thr=${p.threshold}${p.error ? ` • ${p.error}` : ''}`}
              className={`flex-1 min-w-0 px-0.5 py-0.5 rounded border text-[9px] font-mono text-center leading-tight overflow-hidden ${probColor(p)}`}
            >
              <div className="truncate">{p.label}</div>
              <div className="font-bold">{p.prob.toFixed(2)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function PredictionsPanel({ bundle, loading }: Props) {
  return (
    <div className="px-2 py-2 space-y-1.5 overflow-hidden">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          ML Predictions
        </div>
        {loading && <span className="text-[10px] text-muted-foreground animate-pulse">loading…</span>}
      </div>
      {bundle ? (
        <div className="space-y-1">
          <Row label="Short" items={bundle.short} />
          <Row label="Long" items={bundle.long} />
          <Row label="Vol" items={bundle.volatility} />
        </div>
      ) : (
        <div className="text-[10px] text-muted-foreground">Waiting for candle…</div>
      )}
    </div>
  );
}
