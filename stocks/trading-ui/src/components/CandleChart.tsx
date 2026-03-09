import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
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
import axios from 'axios';
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
  /** Extra snapshot fields for predict */
  atr?: number;
  highOfDay?: number;
  lowOfDay?: number;
  preMarketHigh?: number | null;
  changePct?: number;
  /** For ML predict: ticker symbol and selected date */
  ticker?: string;
  selectedDate?: string;
}

interface TooltipData {
  x: number;
  y: number;
  candle: Candle;
  candleIdx: number;
  ema9Val: number | null;
  ema20Val: number | null;
  vwapVal: number | null;
  rsi: number | null;
  volume: number;
}

interface PredictResult {
  tradeable: boolean;
  prob: number;
  threshold: number;
}

/** Imperative handle exposed via ref for real-time updates. */
export interface CandleChartHandle {
  /** Call update() on the candlestick + volume series for a real-time tick. */
  appendCandle: (candle: { time: number; open: number; high: number; low: number; close: number; volume: number }) => void;
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

const CandleChart = forwardRef<CandleChartHandle, Props>(function CandleChart({ candles, title, vwap, vwap_line, ema9, ema20, height = 340, simMode, onCandleClick, strategy, atr, highOfDay, lowOfDay, preMarketHigh, changePct, ticker, selectedDate }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const overlaySeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const onCandleClickRef = useRef(onCandleClick);
  const overlayRef = useRef(new PatternOverlay());
  const initialLoadRef = useRef(true);
  const etOffsetSecRef = useRef(0);
  const candlesRef = useRef(candles);
  onCandleClickRef.current = onCandleClick;
  candlesRef.current = candles;

  // Expose appendCandle to parent for real-time updates
  useImperativeHandle(ref, () => ({
    appendCandle: (candle) => {
      if (!candleSeriesRef.current || !volSeriesRef.current) return;
      const etSec = candle.time + etOffsetSecRef.current;
      candleSeriesRef.current.update({
        time: etSec as any,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      });
      volSeriesRef.current.update({
        time: etSec as any,
        value: candle.volume,
        color: candle.close >= candle.open ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
      });
    },
  }), []);

  // Tooltip state
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [prediction, setPrediction] = useState<PredictResult | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [threshold, setThreshold] = useState(0.7);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Precompute per-candle indicator values
  const indicatorsRef = useRef<{ ema9: (number | null)[]; ema20: (number | null)[]; vwap: (number | null)[]; rsi: (number | null)[] }>({ ema9: [], ema20: [], vwap: [], rsi: [] });

  useEffect(() => {
    if (!candles.length) return;
    // EMA
    const computeEMA = (period: number): (number | null)[] => {
      const k = 2 / (period + 1);
      const result: (number | null)[] = [];
      let prev: number | null = null;
      let seedSum = 0;
      for (let i = 0; i < candles.length; i++) {
        const close = candles[i].c;
        if (i < period - 1) { seedSum += close; result.push(null); continue; }
        if (i === period - 1) { prev = (seedSum + close) / period; result.push(prev); continue; }
        prev = close * k + prev! * (1 - k);
        result.push(prev);
      }
      return result;
    };
    // VWAP per-candle (cumulative from market open)
    const computeVWAP = (): (number | null)[] => {
      const result: (number | null)[] = [];
      let cumPV = 0, cumV = 0, lastDay = '';
      for (const c of candles) {
        const dt = new Date(c.t);
        const day = dt.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
        if (day !== lastDay) { cumPV = 0; cumV = 0; lastDay = day; }
        const tp = (c.h + c.l + c.c) / 3;
        cumPV += tp * c.v;
        cumV += c.v;
        result.push(cumV > 0 ? cumPV / cumV : null);
      }
      return result;
    };
    // RSI 14
    const computeRSI = (): (number | null)[] => {
      const period = 14;
      const result: (number | null)[] = [];
      let avgGain = 0, avgLoss = 0;
      for (let i = 0; i < candles.length; i++) {
        if (i === 0) { result.push(null); continue; }
        const change = candles[i].c - candles[i - 1].c;
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;
        if (i <= period) {
          avgGain += gain;
          avgLoss += loss;
          if (i < period) { result.push(null); continue; }
          avgGain /= period;
          avgLoss /= period;
        } else {
          avgGain = (avgGain * (period - 1) + gain) / period;
          avgLoss = (avgLoss * (period - 1) + loss) / period;
        }
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        result.push(100 - 100 / (1 + rs));
      }
      return result;
    };
    indicatorsRef.current = {
      ema9: computeEMA(9),
      ema20: computeEMA(20),
      vwap: computeVWAP(),
      rsi: computeRSI(),
    };
  }, [candles]);

  // Build time→index map for crosshair lookup
  const timeToIndexRef = useRef<Map<number, number>>(new Map());

  // Predict handler
  const handlePredict = useCallback(async (candleIdx: number) => {
    if (!candles.length) return;
    const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const isHistorical = selectedDate && selectedDate !== todayET && ticker;

    let payload: Record<string, unknown>;
    if (isHistorical) {
      // Historical mode: NestJS fetches candles from MySQL
      const candleDate = new Date(candles[candleIdx].t);
      const candleTimeET = candleDate.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
      }); // "09:35" format
      payload = {
        ticker,
        date: selectedDate,
        candle_time_et: candleTimeET,
      };
    } else {
      // Live/today mode: send full candle history
      payload = {
        target_idx: candleIdx,
        candles: candles.map(cd => ({
          t: cd.t,
          o: cd.o,
          h: cd.h,
          l: cd.l,
          c: cd.c,
          v: cd.v,
        })),
        atr: atr ?? 0,
        high_of_day: highOfDay ?? 0,
        low_of_day: lowOfDay ?? 0,
        pre_market_high: preMarketHigh ?? 0,
        change_pct_at_candle: changePct ?? 0,
      };
    }
    setPredicting(true);
    setPrediction(null);
    try {
      const { data } = await axios.post<PredictResult>(`/api/predict?threshold=${threshold}`, payload);
      setPrediction(data);
    } catch {
      setPrediction({ tradeable: false, prob: 0, threshold });
    } finally {
      setPredicting(false);
    }
  }, [candles, atr, highOfDay, lowOfDay, changePct, preMarketHigh, ticker, selectedDate, threshold]);

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

    // Click handler → pin tooltip on clicked candle (or replay mode)
    chart.subscribeClick((param) => {
      if (param.time == null) {
        // Clicked on empty area → dismiss tooltip
        setTooltip(null);
        setPrediction(null);
        return;
      }

      // Replay mode: forward to parent
      if (onCandleClickRef.current) {
        const ms = ((param.time as number) - etOffsetSecRef.current) * 1000;
        onCandleClickRef.current(ms);
        return;
      }

      // Pin tooltip on this candle
      const fakeEtSec = param.time as number;
      const idx = timeToIndexRef.current.get(fakeEtSec);
      if (idx == null) return;
      const c = candlesRef.current[idx];
      if (!c) return;
      const ind = indicatorsRef.current;
      setTooltip({
        x: 0,
        y: 0,
        candle: c,
        candleIdx: idx,
        ema9Val: ind.ema9[idx] ?? null,
        ema20Val: ind.ema20[idx] ?? null,
        vwapVal: ind.vwap[idx] ?? null,
        rsi: ind.rsi[idx] ?? null,
        volume: c.v,
      });
      setPrediction(null);
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

    // Build time→index map for crosshair tooltip lookup
    const map = new Map<number, number>();
    candleData.forEach((cd, i) => map.set(cd.time as number, i));
    timeToIndexRef.current = map;

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
          position: 'relative',
        }}
      >
        {/* Pinned tooltip panel — click a candle to show, click empty area to dismiss */}
        {tooltip && (
          <div
            ref={tooltipRef}
            style={{
              position: 'absolute',
              left: 12,
              top: 12,
              zIndex: 50,
              background: 'rgba(15,23,42,0.92)',
              border: '1px solid #334155',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              color: '#e2e8f0',
              pointerEvents: 'auto',
              minWidth: 190,
              boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontWeight: 600 }}>
              <span style={{ color: tooltip.candle.c >= tooltip.candle.o ? '#4ade80' : '#f87171' }}>
                {tooltip.candle.c >= tooltip.candle.o ? '▲' : '▼'} {tooltip.candle.c.toFixed(2)}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#64748b', fontSize: 10 }}>
                  {new Date(tooltip.candle.t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false })} ET
                </span>
                <span
                  onClick={() => { setTooltip(null); setPrediction(null); }}
                  style={{ color: '#64748b', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}
                  title="Cerrar"
                >✕</span>
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', marginBottom: 6 }}>
              <span>O <b>{tooltip.candle.o.toFixed(2)}</b></span>
              <span>H <b>{tooltip.candle.h.toFixed(2)}</b></span>
              <span>L <b>{tooltip.candle.l.toFixed(2)}</b></span>
              <span>C <b>{tooltip.candle.c.toFixed(2)}</b></span>
            </div>
            <div style={{ borderTop: '1px solid #1e293b', paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span>Vol <b style={{ color: '#60a5fa' }}>{tooltip.volume.toLocaleString()}</b></span>
              {tooltip.vwapVal != null && <span style={{ color: '#facc15' }}>VWAP <b>{tooltip.vwapVal.toFixed(2)}</b></span>}
              {tooltip.ema9Val != null && <span style={{ color: '#38bdf8' }}>EMA9 <b>{tooltip.ema9Val.toFixed(2)}</b></span>}
              {tooltip.ema20Val != null && <span style={{ color: '#a78bfa' }}>EMA20 <b>{tooltip.ema20Val.toFixed(2)}</b></span>}
              {tooltip.rsi != null && (
                <span style={{ color: tooltip.rsi > 70 ? '#f87171' : tooltip.rsi < 30 ? '#4ade80' : '#94a3b8' }}>
                  RSI <b>{tooltip.rsi.toFixed(1)}</b>
                </span>
              )}
            </div>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, color: '#94a3b8', whiteSpace: 'nowrap' }}>Th</span>
                <input
                  type="range"
                  min={0.4}
                  max={0.8}
                  step={0.05}
                  value={threshold}
                  onChange={(e) => { e.stopPropagation(); setThreshold(parseFloat(e.target.value)); setPrediction(null); }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: 80, height: 12, accentColor: '#8b5cf6', cursor: 'pointer' }}
                />
                <span style={{ fontSize: 10, color: '#e2e8f0', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", minWidth: 28 }}>{threshold.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                onClick={(e) => { e.stopPropagation(); handlePredict(tooltip.candleIdx); }}
                disabled={predicting}
                style={{
                  background: predicting ? '#334155' : 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '5px 14px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: predicting ? 'wait' : 'pointer',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {predicting ? '...' : '🔮 Predecir'}
              </button>
              {prediction && (
                <span style={{
                  fontWeight: 700,
                  color: prediction.tradeable ? '#4ade80' : '#f87171',
                  fontSize: 11,
                }}>
                  {prediction.tradeable ? '✅ LONG' : '❌ NO'} {(prediction.prob * 100).toFixed(0)}%
                </span>
              )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default CandleChart;
