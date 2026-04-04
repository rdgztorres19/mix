import React, { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useChartStore } from '../stores/chart.store';
import { createChart, type IChartApi, type ISeriesApi, ColorType, CrosshairMode } from 'lightweight-charts';
import { ArrowLeft, Play } from 'lucide-react';

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
    }
  }, [symbol, date]);

  useEffect(() => {
    if (!chartContainerRef.current || !store.candles.length) return;

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0f172a' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#334155' },
      timeScale: { borderColor: '#334155', timeVisible: true, secondsVisible: false },
      width: chartContainerRef.current.clientWidth,
      height: 500,
    });
    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    const candleData = store.candles.map((c) => ({
      time: Math.floor(c.t / 1000) as any,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
    }));
    candleSeries.setData(candleData);

    // Volume series
    const volumeSeries = chart.addHistogramSeries({
      color: '#334155',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    const volumeData = store.candles.map((c) => ({
      time: Math.floor(c.t / 1000) as any,
      value: c.v,
      color: c.c >= c.o ? '#10b98133' : '#ef444433',
    }));
    volumeSeries.setData(volumeData);

    // VWAP overlay
    const vwapData = store.indicators
      .map((ind, i) => ind.vwap != null ? { time: Math.floor(store.candles[i].t / 1000) as any, value: ind.vwap } : null)
      .filter(Boolean) as any[];
    if (vwapData.length) {
      const vwapSeries = chart.addLineSeries({ color: '#818cf8', lineWidth: 2, title: 'VWAP' });
      vwapSeries.setData(vwapData);
    }

    // EMA9 overlay
    const ema9Data = store.indicators
      .map((ind, i) => ind.ema9 != null ? { time: Math.floor(store.candles[i].t / 1000) as any, value: ind.ema9 } : null)
      .filter(Boolean) as any[];
    if (ema9Data.length) {
      const ema9Series = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1, title: 'EMA9' });
      ema9Series.setData(ema9Data);
    }

    // EMA20 overlay
    const ema20Data = store.indicators
      .map((ind, i) => ind.ema20 != null ? { time: Math.floor(store.candles[i].t / 1000) as any, value: ind.ema20 } : null)
      .filter(Boolean) as any[];
    if (ema20Data.length) {
      const ema20Series = chart.addLineSeries({ color: '#06b6d4', lineWidth: 1, title: 'EMA20' });
      ema20Series.setData(ema20Data);
    }

    chart.timeScale().fitContent();

    // Resize handler
    const resizeObserver = new ResizeObserver(() => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [store.candles, store.indicators]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-slate-200">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-2xl font-semibold text-slate-100">
            {symbol} <span className="text-slate-500 text-lg">{date}</span>
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Timeframe toggle */}
          <div className="flex bg-slate-800 rounded-lg p-0.5">
            {(['1m', '5m'] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => { store.setTimeframe(tf); store.fetchCandles(); }}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  store.timeframe === tf
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <button
            onClick={() => navigate(`/simulator/${symbol}/${date}`)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Play size={14} />
            Enter Simulator
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        <div ref={chartContainerRef} className="w-full" />
      </div>

      {/* News sidebar */}
      {store.news.length > 0 && (
        <div className="mt-4 bg-slate-900 rounded-xl border border-slate-800 p-4">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">News</h2>
          <div className="space-y-2">
            {store.news.map((n: any, i: number) => (
              <div key={i} className="border-l-2 border-slate-700 pl-3">
                <p className="text-sm text-slate-200">{n.headline}</p>
                <p className="text-xs text-slate-500 mt-1">{n.source} · {n.created_at}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
