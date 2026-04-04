import { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useChartStore } from '@/stores/chart.store';
import { createChart, type IChartApi, ColorType, CrosshairMode, LineStyle } from 'lightweight-charts';
import { Card, CardHeader, CardTitle, CardToolbar, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Play } from 'lucide-react';
import { prepareChartData, computeVolumeMA } from '@/lib/chart-utils';

export function ChartPage() {
  const { symbol, date } = useParams<{ symbol: string; date: string }>();
  const navigate = useNavigate();
  const store = useChartStore();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (symbol && date) {
      store.setSymbol(symbol);
      store.setDate(date);
      store.fetchCandles();
      store.fetchNews();
      store.fetchProfile();
    }
  }, [symbol, date]);

  useEffect(() => {
    if (!chartContainerRef.current || !store.candles.length) return;
    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }

    const chart = createChart(chartContainerRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#09090b' }, textColor: '#71717a', fontSize: 11 },
      grid: { vertLines: { color: '#18181b' }, horzLines: { color: '#18181b' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#27272a', scaleMargins: { top: 0.02, bottom: 0.15 } },
      timeScale: { borderColor: '#27272a', timeVisible: true, secondsVisible: false },
      width: chartContainerRef.current.clientWidth,
      height: 520,
    });
    chartRef.current = chart;

    const prepared = prepareChartData(store.candles, store.indicators);

    // ── 1. Candlesticks (green up, red down) ──
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });
    candleSeries.setData(prepared.map((d) => ({
      time: d.ts as any, open: d.c.o, high: d.c.h, low: d.c.l, close: d.c.c,
    })));

    // ── 2. Volume + Average Volume Line ──
    const volSeries = chart.addHistogramSeries({
      color: '#334155', priceFormat: { type: 'volume' }, priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volSeries.setData(prepared.map((d) => ({
      time: d.ts as any, value: d.c.v,
      color: d.c.c >= d.c.o ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
    })));

    const volumes = prepared.map((d) => d.c.v);
    const volMA = computeVolumeMA(volumes, 20);
    const volMAData = prepared
      .map((d, i) => volMA[i] != null ? { time: d.ts as any, value: volMA[i]! } : null)
      .filter(Boolean) as any[];
    if (volMAData.length) {
      chart.addLineSeries({ color: '#f97316', lineWidth: 1, priceScaleId: 'volume', title: 'Vol Avg', lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }).setData(volMAData);
    }

    // Common options to hide the horizontal "last value" line on indicators
    const overlayOpts = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };

    // ── 3. 9 EMA (yellow — short-term momentum) ──
    const ema9Data = prepared.filter((d) => d.ind?.ema9 != null).map((d) => ({ time: d.ts as any, value: d.ind.ema9! }));
    if (ema9Data.length) chart.addLineSeries({ color: '#facc15', lineWidth: 1, title: '9 EMA', ...overlayOpts }).setData(ema9Data);

    // ── 4. 20 EMA (cyan — short-term momentum) ──
    const ema20Data = prepared.filter((d) => d.ind?.ema20 != null).map((d) => ({ time: d.ts as any, value: d.ind.ema20! }));
    if (ema20Data.length) chart.addLineSeries({ color: '#22d3ee', lineWidth: 1, title: '20 EMA', ...overlayOpts }).setData(ema20Data);

    // ── 5. VWAP (most critical intraday tool — purple) ──
    const vwapData = prepared.filter((d) => d.ind?.vwap != null).map((d) => ({ time: d.ts as any, value: d.ind.vwap! }));
    if (vwapData.length) chart.addLineSeries({ color: '#a78bfa', lineWidth: 2, title: 'VWAP', ...overlayOpts }).setData(vwapData);

    // ── 6. Previous Day Close (most important — white dashed, thick) ──
    const levels = store.levels;
    if (levels?.prevClose != null) {
      candleSeries.createPriceLine({
        price: levels.prevClose, color: '#ffffff', lineWidth: 2,
        lineStyle: LineStyle.LargeDashed, axisLabelVisible: true, title: 'PCL',
      });
    }

    // ── 7. Pre-market High (magenta dotted) ──
    if (levels?.preMarketHigh != null) {
      candleSeries.createPriceLine({
        price: levels.preMarketHigh, color: '#f472b6', lineWidth: 1,
        lineStyle: LineStyle.SparseDotted, axisLabelVisible: true, title: 'PM High',
      });
    }

    // ── Pre-market Low (lime dotted) ──
    if (levels?.preMarketLow != null) {
      candleSeries.createPriceLine({
        price: levels.preMarketLow, color: '#a3e635', lineWidth: 1,
        lineStyle: LineStyle.SparseDotted, axisLabelVisible: true, title: 'PM Low',
      });
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth });
    });
    ro.observe(chartContainerRef.current);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [store.candles, store.indicators, store.levels]);

  return (
    <div className="container-fluid">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" mode="icon" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-xl font-semibold">{symbol}</h1>
          <Badge variant="secondary" size="sm">{date}</Badge>
        </div>
        <div className="flex items-center gap-2.5">
          <Tabs value={store.timeframe} onValueChange={(v) => { store.setTimeframe(v as '1m' | '5m'); store.fetchCandles(); }}>
            <TabsList variant="default" size="sm">
              <TabsTrigger value="1m">1m</TabsTrigger>
              <TabsTrigger value="5m">5m</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="mono" size="sm" onClick={() => navigate(`/simulator/${symbol}/${date}`)}>
            <Play className="size-3.5" /> Simulator
          </Button>
        </div>
      </div>

      {/* Profile stats */}
      {(store.profile || store.indicators.length > 0) && (
        <div className="grid grid-cols-4 gap-3 mb-5">
          <Card>
            <CardContent className="py-3">
              <div className="text-xs text-muted-foreground font-medium">Market Cap</div>
              <div className="text-lg font-semibold font-mono">{formatMarketCap(store.profile?.market_cap)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <div className="text-xs text-muted-foreground font-medium">Shares Outstanding</div>
              <div className="text-lg font-semibold font-mono">{formatShares(store.profile?.shares_outstanding)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <div className="text-xs text-muted-foreground font-medium">Float</div>
              <div className="text-lg font-semibold font-mono">{formatShares(store.profile?.shares_outstanding)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <div className="text-xs text-muted-foreground font-medium">ATR (14)</div>
              <div className="text-lg font-semibold font-mono">
                {store.indicators.length > 0
                  ? `$${store.indicators[store.indicators.length - 1].atr.toFixed(2)}`
                  : 'N/A'}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Chart legend + chart */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="w-4 h-[2px] bg-[#a78bfa] inline-block"></span> VWAP</span>
            <span className="flex items-center gap-1.5"><span className="w-4 h-[2px] bg-[#facc15] inline-block"></span> 9 EMA</span>
            <span className="flex items-center gap-1.5"><span className="w-4 h-[2px] bg-[#22d3ee] inline-block"></span> 20 EMA</span>
            <span className="flex items-center gap-1.5"><span className="w-4 h-[2px] bg-white inline-block"></span> Prev Close</span>
            <span className="flex items-center gap-1.5"><span className="w-4 h-[2px] bg-[#f472b6] inline-block"></span> PM High</span>
            <span className="flex items-center gap-1.5"><span className="w-4 h-[2px] bg-[#a3e635] inline-block"></span> PM Low</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div ref={chartContainerRef} className="w-full" />
        </CardContent>
      </Card>

      {/* News */}
      {store.news.length > 0 && (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>News & Catalysts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {store.news.map((n: any, i: number) => (
                <div key={i} className="border-s-2 border-border ps-3">
                  <p className="text-sm">{n.headline}</p>
                  <p className="text-xs text-muted-foreground mt-1">{n.source} &middot; {n.created_at}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function formatMarketCap(v: number | string | null): string {
  const n = Number(v);
  if (v == null || isNaN(n)) return 'N/A';
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}B`;
  if (n >= 1) return `$${n.toFixed(1)}M`;
  return `$${(n * 1_000).toFixed(0)}K`;
}

function formatShares(v: number | string | null): string {
  const n = Number(v);
  if (v == null || isNaN(n)) return 'N/A';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}
