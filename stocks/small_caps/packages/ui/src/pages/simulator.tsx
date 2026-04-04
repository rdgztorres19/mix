import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSimulatorStore, STRATEGY_SOURCES } from '@/stores/simulator.store';
import { createChart, type IChartApi, type ISeriesApi, ColorType, CrosshairMode } from 'lightweight-charts';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, ChevronLeft, ChevronRight, SkipBack, SkipForward, Play, Pause, Eye, EyeOff, MousePointerClick, BrainCircuit, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { prepareChartData, utcToET } from '@/lib/chart-utils';
import { PredictionsPanel } from '@/components/PredictionsPanel';

export function SimulatorPage() {
  const { symbol, date } = useParams<{ symbol: string; date: string }>();
  const navigate = useNavigate();
  const store = useSimulatorStore();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{
    candle: ISeriesApi<'Candlestick'>;
    volume: ISeriesApi<'Histogram'>;
    vwap: ISeriesApi<'Line'>;
    ema9: ISeriesApi<'Line'>;
    ema20: ISeriesApi<'Line'>;
    patternLines: ISeriesApi<'Line'>[];
    priceLines: any[];
  } | null>(null);
  const intervalRef = useRef<number | null>(null);
  const isFirstRender = useRef(true);

  const [showPatterns, setShowPatterns] = useState(true);
  const [pickingStart, setPickingStart] = useState(false);
  const [simStarted, setSimStarted] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  useEffect(() => {
    if (symbol && date) {
      store.setSymbol(symbol); store.setDate(date);
      store.fetchState(999999);
    }
  }, [symbol, date]);

  useEffect(() => {
    if (store.playing && simStarted) {
      intervalRef.current = window.setInterval(() => store.stepForward(), store.speed);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current); intervalRef.current = null;
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [store.playing, store.speed, simStarted]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!simStarted) return;
      if (e.key === 'ArrowRight') store.stepForward();
      if (e.key === 'ArrowLeft') store.stepBackward();
      if (e.key === ' ') { e.preventDefault(); store.togglePlay(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [simStarted]);

  const getChartHeight = () => {
    if (!chartContainerRef.current) return 500;
    const parent = chartContainerRef.current.parentElement;
    return parent ? parent.clientHeight - 8 : 500;
  };

  // ── Create chart ONCE ──
  useEffect(() => {
    if (!chartContainerRef.current) return;
    if (chartRef.current) return; // Already created

    const chart = createChart(chartContainerRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#09090b' }, textColor: '#71717a', fontSize: 11 },
      grid: { vertLines: { color: '#18181b' }, horzLines: { color: '#18181b' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#27272a', scaleMargins: { top: 0.02, bottom: 0.02 } },
      timeScale: { borderColor: '#27272a', timeVisible: true, secondsVisible: false, rightOffset: 15 },
      width: chartContainerRef.current.clientWidth,
      height: getChartHeight(),
    });
    chartRef.current = chart;

    const overlayOpts = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };

    const candle = chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });
    const volume = chart.addHistogramSeries({ color: '#334155', priceFormat: { type: 'volume' }, priceScaleId: 'volume' });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const vwap = chart.addLineSeries({ color: '#a78bfa', lineWidth: 2, title: 'VWAP', ...overlayOpts });
    const ema9 = chart.addLineSeries({ color: '#facc15', lineWidth: 1, title: '9 EMA', ...overlayOpts });
    const ema20 = chart.addLineSeries({ color: '#22d3ee', lineWidth: 1, title: '20 EMA', ...overlayOpts });

    seriesRef.current = { candle, volume, vwap, ema9, ema20, patternLines: [], priceLines: [] };
    isFirstRender.current = true;

    const ro = new ResizeObserver(() => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth, height: getChartHeight() });
      }
    });
    ro.observe(chartContainerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // ── Update data on each state change (preserves zoom) ──
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current || !store.state?.candles.length) return;

    const chart = chartRef.current;
    const series = seriesRef.current;
    const prepared = prepareChartData(store.state.candles, store.state.indicators);

    // Update candle data
    series.candle.setData(prepared.map((d) => ({
      time: d.ts as any, open: d.c.o, high: d.c.h, low: d.c.l, close: d.c.c,
    })));

    // Update volume
    series.volume.setData(prepared.map((d) => ({
      time: d.ts as any, value: d.c.v,
      color: d.c.c >= d.c.o ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
    })));

    // Update overlays
    const vwapData = prepared.filter((d) => d.ind?.vwap != null).map((d) => ({ time: d.ts as any, value: d.ind.vwap! }));
    series.vwap.setData(vwapData);
    const ema9Data = prepared.filter((d) => d.ind?.ema9 != null).map((d) => ({ time: d.ts as any, value: d.ind.ema9! }));
    series.ema9.setData(ema9Data);
    const ema20Data = prepared.filter((d) => d.ind?.ema20 != null).map((d) => ({ time: d.ts as any, value: d.ind.ema20! }));
    series.ema20.setData(ema20Data);

    // Remove old pattern lines
    for (const pl of series.patternLines) {
      chart.removeSeries(pl);
    }
    series.patternLines = [];

    // Remove old price lines from candle series
    // (lightweight-charts doesn't have removeAllPriceLines, so we recreate by removing series price lines)
    // Workaround: we track them. For simplicity, just remove all and re-add.
    // Actually createPriceLine returns the line, we'd need to track them. Simpler: use a flag.

    // Remove old price lines from previous step
    for (const pl of series.priceLines) {
      series.candle.removePriceLine(pl);
    }
    series.priceLines = [];

    const allMarkers: any[] = [];

    // S/R + Strategy levels as price lines
    if (simStarted) {
      const skipDynamic = new Set(['VWAP', '50 SMA', '200 SMA']);
      for (const sr of store.state.supportResistanceLevels) {
        if (skipDynamic.has(sr.label)) continue;
        const color = sr.label === 'Prev Close' ? '#ffffff'
          : sr.label === 'PM High' ? '#f472b6'
          : sr.label === 'PM Low' ? '#a3e635'
          : sr.type === 'support' ? '#22c55e'
          : sr.type === 'resistance' ? '#ef4444' : '#818cf8';
        const lineStyle = sr.label === 'Prev Close' ? 4 : 3;
        series.priceLines.push(series.candle.createPriceLine({ price: sr.price, color, lineWidth: sr.label === 'Prev Close' ? 2 : 1, lineStyle, axisLabelVisible: true, title: sr.label }));
      }

      const strats = store.state.activeStrategies;
      if (strats.length > 0) {
        const lvl = strats[0].levels;
        series.priceLines.push(series.candle.createPriceLine({ price: lvl.entry, color: '#3b82f6', lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: 'Entry' }));
        series.priceLines.push(series.candle.createPriceLine({ price: lvl.stop, color: '#ef4444', lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: 'Stop' }));
        series.priceLines.push(series.candle.createPriceLine({ price: lvl.target1, color: '#22c55e', lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: 'T1' }));
        series.priceLines.push(series.candle.createPriceLine({ price: lvl.target2, color: '#06b6d4', lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: 'T2' }));
      }
    }

    // Pattern lines
    const validTimes = new Set(prepared.map((d) => d.ts));
    const snapToValid = (ts: number) => {
      if (validTimes.has(ts)) return ts;
      let best = prepared[0]?.ts ?? ts;
      let bestDiff = Math.abs(ts - best);
      for (const d of prepared) {
        const diff = Math.abs(ts - d.ts);
        if (diff < bestDiff) { best = d.ts; bestDiff = diff; }
      }
      return best;
    };

    if (simStarted && store.state.rulesResult?.detected_patterns?.length) {
      const patternColors: Record<string, string> = {
        BULL_FLAG: '#22c55e', ABCD: '#3b82f6', ORB: '#f59e0b',
        VWAP_REVERSAL: '#a78bfa', FALLEN_ANGEL: '#ef4444',
      };
      for (const pattern of store.state.rulesResult.detected_patterns) {
        if (!pattern.anchor_points?.length) continue;
        const color = patternColors[pattern.name] ?? '#818cf8';
        const seen = new Set<number>();
        const lineData: { time: any; value: number }[] = [];
        for (const pt of pattern.anchor_points) {
          const ts = snapToValid(utcToET(pt.time));
          if (!seen.has(ts)) { seen.add(ts); lineData.push({ time: ts as any, value: pt.price }); }
        }
        lineData.sort((a, b) => (a.time as number) - (b.time as number));
        if (lineData.length >= 2) {
          const pl = chart.addLineSeries({
            color, lineWidth: 2, lineStyle: 0,
            lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
          });
          pl.setData(lineData);
          series.patternLines.push(pl);
        }
        for (const pt of pattern.anchor_points) {
          allMarkers.push({
            time: snapToValid(utcToET(pt.time)) as any,
            position: 'aboveBar' as const, color, shape: 'arrowDown' as const, text: pt.label,
          });
        }
      }
    }

    // Candlestick pattern markers
    if (showPatterns && simStarted && store.state.candlestickPatterns.length) {
      store.state.candlestickPatterns
        .filter((p) => p.candleIdx < prepared.length)
        .forEach((p) => {
          allMarkers.push({
            time: prepared[Math.min(p.candleIdx, prepared.length - 1)].ts as any,
            position: p.significance === 'bullish' ? 'belowBar' as const : 'aboveBar' as const,
            color: p.significance === 'bullish' ? '#22c55e' : p.significance === 'bearish' ? '#ef4444' : '#818cf8',
            shape: 'circle' as const, text: p.name,
          });
        });
    }

    if (allMarkers.length) {
      allMarkers.sort((a, b) => (a.time as number) - (b.time as number));
      series.candle.setMarkers(allMarkers);
    } else {
      series.candle.setMarkers([]);
    }

    // Only fit/scroll on first render or when picking start
    if (isFirstRender.current || !simStarted) {
      if (simStarted && prepared.length > 0) {
        chart.timeScale().scrollToPosition(15, false);
      } else {
        chart.timeScale().fitContent();
      }
      isFirstRender.current = false;
    }

    // Click handler for picking start
    if (pickingStart && chartContainerRef.current) {
      chartContainerRef.current.style.cursor = 'crosshair';
    }

  }, [store.state, showPatterns, simStarted]);

  // ── Pick start click handler (separate to avoid re-binds) ──
  useEffect(() => {
    if (!chartRef.current || !pickingStart) return;
    const chart = chartRef.current;

    const clickHandler = (param: any) => {
      if (!param.time || !store.state) return;
      const prepared = prepareChartData(store.state.candles, store.state.indicators);
      const clickedTs = param.time as number;
      let closestIdx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < prepared.length; i++) {
        const diff = Math.abs(prepared[i].ts - clickedTs);
        if (diff < minDiff) { minDiff = diff; closestIdx = i; }
      }
      setPickingStart(false);
      setSimStarted(true);
      isFirstRender.current = true;
      store.seekTo(closestIdx);
      if (chartContainerRef.current) chartContainerRef.current.style.cursor = 'default';
    };

    chart.subscribeClick(clickHandler);
    return () => { chart.unsubscribeClick(clickHandler); };
  }, [pickingStart, store.state]);

  const state = store.state;
  const rulesResult = state?.rulesResult;
  const activeStrats = state?.activeStrategies ?? [];

  return (
    <div className="flex h-full w-full overflow-hidden -mt-5 -mb-8">
      {/* Left panel */}
      {leftOpen && (
      <div className="w-[240px] shrink-0 border-e border-border overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="p-4">
            <h2 className="text-sm font-semibold mb-3">Strategy Signals</h2>
            {!simStarted ? (
              <div className="text-xs text-muted-foreground">
                Click "Pick Start" and click on the chart to begin simulation.
              </div>
            ) : activeStrats.length > 0 ? activeStrats.map((strat, i) => (
              <Card key={i} className="mb-3">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-bold">{strat.name}</span>
                    <Badge variant="info" appearance="light" size="xs">{strat.source}</Badge>
                  </div>
                  {strat.guidance?.what_to_watch && (
                    <div className="mb-2">
                      <div className="text-[10px] uppercase text-muted-foreground font-semibold">What to watch</div>
                      <p className="text-xs">{strat.guidance.what_to_watch}</p>
                    </div>
                  )}
                  {strat.guidance?.confirmation_signals?.length > 0 && (
                    <div className="mb-2">
                      <div className="text-[10px] uppercase text-muted-foreground font-semibold">Confirmation</div>
                      <ul className="text-xs text-muted-foreground space-y-0.5">
                        {strat.guidance.confirmation_signals.map((s: string, j: number) => <li key={j}>&bull; {s}</li>)}
                      </ul>
                    </div>
                  )}
                  {strat.guidance?.invalidation && (
                    <div>
                      <div className="text-[10px] uppercase text-red-500 font-semibold">Invalidation</div>
                      <p className="text-xs text-muted-foreground">{strat.guidance.invalidation}</p>
                    </div>
                  )}
                  <Separator className="my-2" />
                  <div className="grid grid-cols-2 gap-1 text-xs font-mono">
                    <div className="rounded bg-blue-500/10 px-2 py-1"><span className="text-blue-400">Entry:</span> ${strat.levels.entry.toFixed(2)}</div>
                    <div className="rounded bg-red-500/10 px-2 py-1"><span className="text-red-400">Stop:</span> ${strat.levels.stop.toFixed(2)}</div>
                    <div className="rounded bg-green-500/10 px-2 py-1"><span className="text-green-400">T1:</span> ${strat.levels.target1.toFixed(2)}</div>
                    <div className="rounded bg-cyan-500/10 px-2 py-1"><span className="text-cyan-400">T2:</span> ${strat.levels.target2.toFixed(2)}</div>
                  </div>
                </CardContent>
              </Card>
            )) : (
              <div className="text-xs text-muted-foreground">
                {rulesResult?.hard_stops?.length ? (
                  <div>
                    <Badge variant="destructive" appearance="light" size="xs" className="mb-2">No viable setup</Badge>
                    {rulesResult.hard_stops.map((s: string, i: number) => <p key={i}>&bull; {s}</p>)}
                  </div>
                ) : 'Advance candles to detect strategies...'}
              </div>
            )}
            {simStarted && rulesResult?.verdict && (
              <>
                <Separator className="my-3" />
                <div className="text-[10px] uppercase text-muted-foreground font-semibold mb-1">Verdict</div>
                <p className="text-xs">{rulesResult.verdict}</p>
              </>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Center */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0 gap-2 min-w-0 overflow-hidden">
          <div className="flex items-center gap-2 min-w-0 overflow-hidden">
            <Button variant="ghost" mode="icon" size="sm" onClick={() => navigate(-1)}><ArrowLeft className="size-4" /></Button>
            <span className="text-sm font-semibold shrink-0">{symbol}</span>
            <Badge variant="secondary" size="xs" className="shrink-0">{date}</Badge>
            {simStarted && (
              <>
                {rulesResult?.session && (
                  <Badge variant="info" appearance="light" size="xs" className="shrink-0">
                    {rulesResult.session}
                  </Badge>
                )}
                <Badge variant="primary" appearance="light" size="xs" className="shrink-0">
                  {store.currentIdx}/{store.maxIdx}
                </Badge>
                {state?.indicators?.length && (
                  <Badge variant="secondary" size="xs" className="shrink-0">
                    ATR ${state.indicators[state.indicators.length - 1].atr.toFixed(2)}
                  </Badge>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Select value={store.source} onValueChange={(v) => store.setSource(v as any)}>
              <SelectTrigger className="w-[140px]" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STRATEGY_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={pickingStart ? 'mono' : 'outline'}
              size="sm"
              onClick={() => { setPickingStart(!pickingStart); setSimStarted(false); isFirstRender.current = true; store.fetchState(999999); }}
            >
              <MousePointerClick className="size-3.5" />
              {pickingStart ? 'Click chart...' : 'Pick Start'}
            </Button>
            <Button
              variant={showPatterns ? 'outline' : 'ghost'}
              size="sm"
              onClick={() => setShowPatterns(!showPatterns)}
            >
              {showPatterns ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            </Button>
            <Button variant="ghost" mode="icon" size="sm" onClick={() => setLeftOpen(!leftOpen)} title="Toggle left panel">
              {leftOpen ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
            </Button>
            <Button variant="ghost" mode="icon" size="sm" onClick={() => setRightOpen(!rightOpen)} title="Toggle right panel">
              {rightOpen ? <PanelRightClose className="size-3.5" /> : <PanelRightOpen className="size-3.5" />}
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 p-1">
          <div ref={chartContainerRef} className="w-full h-full" />
        </div>

        {simStarted && (
          <div className="h-12 border-t border-border flex items-center gap-2 px-3 shrink-0 overflow-hidden min-w-0">
            <Button variant="ghost" mode="icon" size="sm" onClick={() => store.seekTo(0)}><SkipBack className="size-3.5" /></Button>
            <Button variant="ghost" mode="icon" size="sm" onClick={store.stepBackward}><ChevronLeft className="size-4" /></Button>
            <Button variant="mono" mode="icon" size="sm" shape="circle" onClick={store.togglePlay}>
              {store.playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </Button>
            <Button variant="ghost" mode="icon" size="sm" onClick={store.stepForward}><ChevronRight className="size-4" /></Button>
            <Button variant="ghost" mode="icon" size="sm" onClick={() => store.seekTo(store.maxIdx)}><SkipForward className="size-3.5" /></Button>
            <Separator orientation="vertical" className="h-5 mx-1 shrink-0" />
            <input type="range" min={100} max={2000} step={100} value={store.speed}
              onChange={(e) => store.setSpeed(Number(e.target.value))} className="w-14 accent-primary shrink-0" />
            <span className="text-[10px] text-muted-foreground font-mono w-9 shrink-0">{store.speed}ms</span>
            <Separator orientation="vertical" className="h-5 mx-1 shrink-0" />
            <input type="range" min={0} max={store.maxIdx} value={store.currentIdx}
              onChange={(e) => store.seekTo(Number(e.target.value))} className="flex-1 min-w-0 accent-primary" />
          </div>
        )}
      </div>

      {/* Right panel */}
      {simStarted && rightOpen && (
        <div className="w-[210px] shrink-0 border-s border-border flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="p-4">
              {showPatterns && (
                <>
                  <h2 className="text-sm font-semibold mb-3">Candlestick Patterns</h2>
                  {state?.candlestickPatterns.length ? (
                    <div className="space-y-2">
                      {state.candlestickPatterns.map((p, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <Badge variant={p.significance === 'bullish' ? 'success' : p.significance === 'bearish' ? 'destructive' : 'info'}
                            appearance="light" size="xs" shape="circle" className="mt-0.5">&nbsp;</Badge>
                          <div>
                            <span className="text-xs font-semibold">{p.name}</span>
                            <span className="text-[10px] text-muted-foreground ml-1">@{p.candleIdx}</span>
                            <p className="text-[10px] text-muted-foreground">{p.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-xs text-muted-foreground">No patterns detected</p>}
                  <Separator className="my-4" />
                </>
              )}
              <h2 className="text-sm font-semibold mb-3">S/R Levels</h2>
              {state?.supportResistanceLevels.length ? (
                <div className="space-y-1.5">
                  {state.supportResistanceLevels.map((sr, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <Badge variant={sr.type === 'support' ? 'success' : sr.type === 'resistance' ? 'destructive' : 'info'}
                        appearance="ghost" size="xs">{sr.label}</Badge>
                      <span className="font-mono">${sr.price.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-muted-foreground">No levels available</p>}
              {rulesResult?.detected_patterns?.length > 0 && (
                <>
                  <Separator className="my-4" />
                  <h2 className="text-sm font-semibold mb-3">Strategy Patterns</h2>
                  <div className="space-y-2">
                    {rulesResult.detected_patterns.map((p: any, i: number) => (
                      <div key={i}>
                        <Badge variant="warning" appearance="light" size="xs">{p.name}</Badge>
                        <p className="text-[10px] text-muted-foreground mt-1">{p.description}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="border-t border-border flex-shrink-0">
            {store.predictionsEnabled && (
              <PredictionsPanel bundle={store.predictions} loading={store.predictionsLoading} />
            )}
            <button
              onClick={() => store.togglePredictions()}
              className="w-full px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/40 transition flex items-center justify-center gap-1.5 border-t border-border/60"
              title="Toggle ML predictions (persists in localStorage)"
            >
              <BrainCircuit className="size-3" />
              ML {store.predictionsEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
