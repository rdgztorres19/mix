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
import type { Candle, VwapPoint, StrategySnapshot } from '../types';
import { PatternOverlay } from './PatternOverlay';

interface Props {
  candles: Candle[];
  title: string;
  vwap?: number | null;
  vwap_line?: VwapPoint[];
  ema9?: number | null;
  ema20?: number | null;
  height?: number;
  simMode?: boolean;
  onCandleClick?: (timestampMs: number) => void;
  strategy?: StrategySnapshot | null;
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

export default function CandleChart({ candles, title, vwap, vwap_line, ema9, ema20, height = 340, simMode, onCandleClick, strategy }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const overlaySeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const onCandleClickRef = useRef(onCandleClick);
  const overlayRef = useRef(new PatternOverlay());
  const initialLoadRef = useRef(true);
  const etOffsetSecRef = useRef(0);
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
        timeFormatter: (timestamp: number) => {
          const d = new Date(timestamp * 1000);
          const hh = String(d.getUTCHours()).padStart(2, '0');
          const mm = String(d.getUTCMinutes()).padStart(2, '0');
          return `${hh}:${mm}`;
        },
        dateFormat: 'MMM d',
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
      // param.time is in "fake ET" seconds — reverse the offset to get real UTC ms
      const ms = ((param.time as number) - etOffsetSecRef.current) * 1000;
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
      overlaySeriesRef.current = [];
      overlayRef.current = new PatternOverlay();
      chart.remove();
    };
  }, [height]);

  // Update data when candles change
  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || !volSeriesRef.current || !candles.length) return;

    // Compute UTC→ET offset (seconds) from the first candle so the X-axis
    // labels show Eastern Time.  lightweight-charts renders timestamps as-is
    // on the axis; there's no built-in TZ support.
    const sampleDate = new Date(candles[0].t);
    const utcStr = sampleDate.toLocaleString('en-US', { timeZone: 'UTC', hour12: false });
    const etStr  = sampleDate.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
    const etOffsetSec = (new Date(etStr).getTime() - new Date(utcStr).getTime()) / 1000;

    /** Convert a UTC-ms timestamp to a "fake UTC" unix-seconds that visually equals ET. */
    const toET = (utcMs: number) => Math.floor(utcMs / 1000) + etOffsetSec;
    etOffsetSecRef.current = etOffsetSec;

    const candleData: CandlestickData[] = candles.map((c) => ({
      time: toET(c.t) as any,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
    }));

    const volData: HistogramData[] = candles.map((c) => ({
      time: toET(c.t) as any,
      value: c.v,
      color: c.c >= c.o ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
    }));

    candleSeriesRef.current.setData(candleData);
    volSeriesRef.current.setData(volData);

    // Remove previously added overlay line series (VWAP, EMA9, EMA20)
    for (const s of overlaySeriesRef.current) {
      try { chartRef.current!.removeSeries(s); } catch { /* series from destroyed chart */ }
    }
    overlaySeriesRef.current = [];

    // ── VWAP: use backend vwap_line when available (guarantees match with legend)
    const vwapOpts = {
      color: '#fbbf24',
      lineWidth: 2 as 1 | 2 | 3 | 4,
      lineStyle: LineStyle.Solid as const,
      lastValueVisible: true,
      priceLineVisible: true,
    };
    if (vwap_line && vwap_line.length > 0) {
      const points = vwap_line.map((p) => ({ time: (p.t + etOffsetSec) as any, value: p.value }));
      const series = chartRef.current!.addLineSeries({ ...vwapOpts, title: 'VWAP' });
      series.setData(points);
      overlaySeriesRef.current.push(series);
    } else {
      // Fallback: compute locally (9:30-16:00 ET, one series per day)
      const MARKET_OPEN_MIN = 9 * 60 + 30;
      const MARKET_CLOSE_MIN = 16 * 60;
      const vwapByDay: { time: any; value: number }[][] = [];
      let currentDayPoints: { time: any; value: number }[] = [];
      let cumPV = 0, cumV = 0, lastEtDate = '';
      for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const dt = new Date(c.t);
        const etDate = dt.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
        const etHour = parseInt(dt.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
        const etMin = parseInt(dt.toLocaleString('en-US', { timeZone: 'America/New_York', minute: 'numeric' }));
        const totalMinutesET = etHour * 60 + etMin;

        if (etDate !== lastEtDate) {
          cumPV = 0;
          cumV = 0;
          lastEtDate = etDate;
          if (currentDayPoints.length) {
            vwapByDay.push(currentDayPoints);
            currentDayPoints = [];
          }
        }
        if (totalMinutesET < MARKET_OPEN_MIN || totalMinutesET > MARKET_CLOSE_MIN) continue;

        const tp = (c.h + c.l + c.c) / 3;
        cumPV += tp * c.v;
        cumV += c.v;
        if (cumV > 0) currentDayPoints.push({ time: candleData[i].time, value: cumPV / cumV });
      }
      if (currentDayPoints.length) vwapByDay.push(currentDayPoints);
      vwapByDay.forEach((points, idx) => {
        const series = chartRef.current!.addLineSeries({
          ...vwapOpts,
          title: idx === 0 ? 'VWAP' : undefined,
        });
        series.setData(points);
        overlaySeriesRef.current.push(series);
      });
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

    // Draw EMA9
    const ema9Points = calcEMA(9);
    if (ema9Points.length) {
      const ema9Series = chartRef.current!.addLineSeries({
        color: '#38bdf8',
        lineWidth: 1 as 1 | 2 | 3 | 4,
        title: 'EMA9',
        lastValueVisible: true,
        priceLineVisible: false,
      });
      ema9Series.setData(ema9Points);
      overlaySeriesRef.current.push(ema9Series);
    }

    // Draw EMA20
    const ema20Points = calcEMA(20);
    if (ema20Points.length) {
      const ema20Series = chartRef.current!.addLineSeries({
        color: '#a78bfa',
        lineWidth: 1 as 1 | 2 | 3 | 4,
        title: 'EMA20',
        lastValueVisible: true,
        priceLineVisible: false,
      });
      ema20Series.setData(ema20Points);
      overlaySeriesRef.current.push(ema20Series);
    }

    // Draw strategy price lines (entry, stop, targets) and pattern markers
    if (strategy && candleSeriesRef.current) {
      const shiftedPoints = strategy.pattern_points?.map((p) => ({
        ...p,
        time: p.time + etOffsetSec * 1000, // shift UTC ms → "fake ET" ms
      }));
      overlayRef.current.apply(chartRef.current!, candleSeriesRef.current, {
        entry: strategy.entry,
        stop: strategy.stop,
        target1: strategy.target_1,
        target2: strategy.target_2,
        patternPoints: shiftedPoints,
      });
    } else if (candleSeriesRef.current) {
      overlayRef.current.clear(candleSeriesRef.current);
    }

    // Only auto-fit on initial load; preserve scroll on subsequent updates (e.g. replay clicks)
    if (initialLoadRef.current) {
      chartRef.current!.timeScale().fitContent();
      initialLoadRef.current = false;
    }
  }, [candles, vwap, vwap_line, ema9, ema20, strategy]);

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
        {strategy?.name && (
          <span style={{
            padding: '2px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
            background: strategy.viable ? 'rgba(34,197,94,0.2)' : 'rgba(234,179,8,0.2)',
            color: strategy.viable ? '#4ade80' : '#eab308',
            border: `1px solid ${strategy.viable ? 'rgba(34,197,94,0.4)' : 'rgba(234,179,8,0.4)'}`,
          }}>
            📐 {strategy.name}
          </span>
        )}
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
