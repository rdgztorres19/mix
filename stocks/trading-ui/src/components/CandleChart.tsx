import { useEffect, useRef } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  ColorType,
  CrosshairMode,
  LineStyle,
} from 'lightweight-charts';
import type { Candle } from '../types';

interface Props {
  candles: Candle[];
  title: string;
  vwap?: number | null;
  ema9?: number | null;
  ema20?: number | null;
  height?: number;
  simMode?: boolean;
  onCandleClick?: (timestampMs: number) => void;
}

const CHART_THEME = {
  background: '#131820',
  text: '#94a3b8',
  grid: '#1a2030',
  border: '#232d3f',
  green: '#22c55e',
  red: '#ef4444',
  greenDim: 'rgba(34,197,94,0.15)',
  redDim: 'rgba(239,68,68,0.15)',
};

export default function CandleChart({ candles, title, vwap, ema9, ema20, height = 340, simMode, onCandleClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const onCandleClickRef = useRef(onCandleClick);
  onCandleClickRef.current = onCandleClick;

  // Initialize chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: CHART_THEME.background },
        textColor: CHART_THEME.text,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: CHART_THEME.grid, style: LineStyle.Dotted },
        horzLines: { color: CHART_THEME.grid, style: LineStyle.Dotted },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#475569', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1e293b' },
        horzLine: { color: '#475569', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1e293b' },
      },
      rightPriceScale: {
        borderColor: CHART_THEME.border,
        scaleMargins: { top: 0.05, bottom: 0.2 },
      },
      timeScale: {
        borderColor: CHART_THEME.border,
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 8,
      },
      localization: {
        timeFormatter: (timestamp: number) =>
          new Date(timestamp * 1000).toLocaleTimeString('en-US', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }),
        dateFormatter: (timestamp: number) =>
          new Date(timestamp * 1000).toLocaleDateString('en-US', {
            timeZone: 'America/New_York',
            month: 'short',
            day: 'numeric',
          }),
      },
      width: containerRef.current.clientWidth,
      height,
    });

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: CHART_THEME.green,
      downColor: CHART_THEME.red,
      borderUpColor: CHART_THEME.green,
      borderDownColor: CHART_THEME.red,
      wickUpColor: CHART_THEME.green,
      wickDownColor: CHART_THEME.red,
    });

    // Volume histogram (on same pane, bottom)
    const volSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volSeriesRef.current = volSeries;

    // Click handler → used in Replay mode to set cutoff at clicked candle
    chart.subscribeClick((param) => {
      if (!onCandleClickRef.current) return;
      if (param.time == null) return;
      const ms = (param.time as number) * 1000;
      onCandleClickRef.current(ms);
    });

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [height]);

  // Update data when candles change
  useEffect(() => {
    if (!candleSeriesRef.current || !volSeriesRef.current || !candles.length) return;

    const candleData: CandlestickData[] = candles.map((c) => ({
      time: Math.floor(c.t / 1000) as any,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
    }));

    const volData: HistogramData[] = candles.map((c) => ({
      time: Math.floor(c.t / 1000) as any,
      value: c.v,
      color: c.c >= c.o ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
    }));

    candleSeriesRef.current.setData(candleData);
    volSeriesRef.current.setData(volData);

    // ── Per-candle indicator calculations ───────────────────────────────────

    // VWAP: starts at 9:30 AM ET each day (regular session only), resets daily
    // Pre-market candles are excluded from VWAP calculation — matches TradingView behavior
    const MARKET_OPEN_HOUR = 9;
    const MARKET_OPEN_MIN  = 30;
    const vwapPoints: { time: any; value: number }[] = [];
    let cumPV = 0, cumV = 0, lastEtDate = '';
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const dt = new Date(c.t);
      const etDate = dt.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
      const etHour = parseInt(dt.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
      const etMin  = dt.toLocaleString('en-US', { timeZone: 'America/New_York', minute: 'numeric' });
      const totalMinutesET = etHour * 60 + parseInt(etMin);
      const marketOpenMinutes = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MIN;

      // Reset on new day
      if (etDate !== lastEtDate) { cumPV = 0; cumV = 0; lastEtDate = etDate; }

      // Only accumulate from 9:30 AM ET onwards
      if (totalMinutesET < marketOpenMinutes) continue;

      const tp = (c.h + c.l + c.c) / 3;
      cumPV += tp * c.v;
      cumV += c.v;
      if (cumV > 0) vwapPoints.push({ time: candleData[i].time, value: cumPV / cumV });
    }

    // EMA helper: returns per-candle values (null until enough data)
    const calcEMA = (period: number): { time: any; value: number }[] => {
      const k = 2 / (period + 1);
      const points: { time: any; value: number }[] = [];
      let prev: number | null = null;
      let seedSum = 0;
      for (let i = 0; i < candles.length; i++) {
        const close = candles[i].c;
        if (i < period - 1) { seedSum += close; continue; }
        if (i === period - 1) {
          prev = (seedSum + close) / period;
          points.push({ time: candleData[i].time, value: prev });
          continue;
        }
        prev = close * k + prev! * (1 - k);
        points.push({ time: candleData[i].time, value: prev });
      }
      return points;
    };

    // Draw VWAP
    if (vwapPoints.length) {
      const vwapSeries = chartRef.current!.addLineSeries({
        color: '#facc15',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: 'VWAP',
        lastValueVisible: true,
        priceLineVisible: false,
      });
      vwapSeries.setData(vwapPoints);
    }

    // Draw EMA9
    const ema9Points = calcEMA(9);
    if (ema9Points.length) {
      const ema9Series = chartRef.current!.addLineSeries({
        color: '#38bdf8',
        lineWidth: 1,
        title: 'EMA9',
        lastValueVisible: true,
        priceLineVisible: false,
      });
      ema9Series.setData(ema9Points);
    }

    // Draw EMA20
    const ema20Points = calcEMA(20);
    if (ema20Points.length) {
      const ema20Series = chartRef.current!.addLineSeries({
        color: '#a78bfa',
        lineWidth: 1,
        title: 'EMA20',
        lastValueVisible: true,
        priceLineVisible: false,
      });
      ema20Series.setData(ema20Points);
    }

    chartRef.current!.timeScale().fitContent();
  }, [candles, vwap, ema9, ema20]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 12px',
        background: simMode ? 'rgba(245,158,11,0.08)' : '#1a2030',
        borderBottom: `1px solid ${simMode ? 'rgba(245,158,11,0.25)' : '#232d3f'}`,
        fontSize: 12,
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{title}</span>
        <span style={{ color: '#64748b' }}>{candles.length} candles</span>
        {vwap && <span style={{ color: '#facc15' }}>VWAP {vwap.toFixed(2)}</span>}
        {ema9 && <span style={{ color: '#38bdf8' }}>EMA9 {ema9.toFixed(2)}</span>}
        {ema20 && <span style={{ color: '#a78bfa' }}>EMA20 {ema20.toFixed(2)}</span>}
        {simMode && (
          <span style={{
            marginLeft: 'auto',
            fontSize: 11,
            color: '#fbbf24',
            opacity: 0.8,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}>
            ⏪ Click en una vela para setear el punto de replay
          </span>
        )}
      </div>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          cursor: simMode ? 'crosshair' : 'default',
        }}
      />
    </div>
  );
}
