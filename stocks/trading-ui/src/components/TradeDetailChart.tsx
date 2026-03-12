import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  LineData,
  ColorType,
  LineStyle,
} from 'lightweight-charts';

export interface TradeCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface RulerPoint {
  time: number;
  price: number;
}

interface TradeDetailChartProps {
  candles: TradeCandle[];
  entryPrice: number;
  exitPrice?: number;
  exitTime?: string;
  height?: number;
}

const CHART_THEME = {
  background: '#131820',
  text: '#94a3b8',
  grid: '#1a2030',
  border: '#232d3f',
  green: '#22c55e',
  red: '#ef4444',
};

function clientToChart(container: HTMLElement, clientX: number, clientY: number) {
  const rect = container.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

export function TradeDetailChart({
  candles,
  entryPrice,
  exitPrice,
  exitTime,
  height = 280,
}: TradeDetailChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const measureLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLineRefs = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]>([]);

  const [measureMode, setMeasureMode] = useState(false);
  const [rulerPoints, setRulerPoints] = useState<[RulerPoint, RulerPoint] | null>(null);
  const isDraggingRef = useRef(false);
  const measureModeRef = useRef(measureMode);
  measureModeRef.current = measureMode;

  const sortedCandlesRef = useRef<{ candles: TradeCandle[]; toET: (ms: number) => number }>({ candles: [], toET: (x) => x });

  const resetMeasure = useCallback(() => {
    setRulerPoints(null);
    if (measureLineRef.current) {
      measureLineRef.current.setData([]);
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current || !candles.length) return;

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
      rightPriceScale: {
        borderColor: CHART_THEME.border,
        scaleMargins: { top: 0.08, bottom: 0.2 },
      },
      timeScale: {
        borderColor: CHART_THEME.border,
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 10,
      },
      localization: {
        timeFormatter: (timestamp: number) => {
          const d = new Date(timestamp * 1000);
          const hh = String(d.getUTCHours()).padStart(2, '0');
          const mm = String(d.getUTCMinutes()).padStart(2, '0');
          return `${hh}:${mm}`;
        },
      },
      width: containerRef.current.clientWidth,
      height,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: CHART_THEME.green,
      downColor: CHART_THEME.red,
      borderUpColor: CHART_THEME.green,
      borderDownColor: CHART_THEME.red,
      wickUpColor: CHART_THEME.green,
      wickDownColor: CHART_THEME.red,
    });

    const volSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    const measureLine = chart.addLineSeries({
      color: '#ef4444',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
    });
    measureLine.applyOptions({ lineStyle: LineStyle.Solid });
    measureLineRef.current = measureLine;

    const container = containerRef.current;
    if (!container) return;

    const onMouseDown = (e: MouseEvent) => {
      if (!measureModeRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const { x, y } = clientToChart(container, e.clientX, e.clientY);
      const time = chart.timeScale().coordinateToTime(x);
      const price = candleSeries.coordinateToPrice(y);
      if (time != null && price != null) {
        const pt: RulerPoint = { time: time as number, price };
        setRulerPoints([pt, pt]);
        isDraggingRef.current = true;
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const { x, y } = clientToChart(container, e.clientX, e.clientY);
      const time = chart.timeScale().coordinateToTime(x);
      const price = candleSeries.coordinateToPrice(y);
      if (time != null && price != null) {
        setRulerPoints((prev) => {
          if (!prev) return null;
          return [prev[0], { time: time as number, price }];
        });
      }
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
    };

    container.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volSeriesRef.current = volSeries;

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      container.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
      measureLineRef.current = null;
      priceLineRefs.current = [];
    };
  }, [height]);

  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || !volSeriesRef.current || !candles.length) return;

    const sorted = [...candles].sort((a, b) => a.t - b.t);
    const sampleDate = new Date(sorted[0].t);
    const utcStr = sampleDate.toLocaleString('en-US', { timeZone: 'UTC', hour12: false });
    const etStr = sampleDate.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
    const etOffsetSec = (new Date(etStr).getTime() - new Date(utcStr).getTime()) / 1000;
    const toET = (utcMs: number) => Math.floor(utcMs / 1000) + etOffsetSec;
    sortedCandlesRef.current = { candles: sorted, toET };

    const candleData: CandlestickData[] = sorted.map((c) => ({
      time: toET(c.t) as any,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
    }));

    const volData: HistogramData[] = sorted.map((c) => ({
      time: toET(c.t) as any,
      value: c.v,
      color: c.c >= c.o ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
    }));

    candleSeriesRef.current.setData(candleData);
    volSeriesRef.current.setData(volData);

    const series = candleSeriesRef.current;
    for (const pl of priceLineRefs.current) {
      series.removePriceLine(pl);
    }
    priceLineRefs.current = [];
    priceLineRefs.current.push(series.createPriceLine({
      price: entryPrice,
      color: '#22c55e',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'Entrada',
    }));
    if (exitPrice != null && exitPrice !== entryPrice) {
      priceLineRefs.current.push(series.createPriceLine({
        price: exitPrice,
        color: '#f59e0b',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: exitTime ? `Salida ${exitTime}` : 'Salida',
      }));
    }
  }, [candles, entryPrice, exitPrice, exitTime]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      handleScroll: measureMode ? { pressedMouseMove: false, mouseWheel: false, horzTouchDrag: false, vertTouchDrag: false } : true,
    });
  }, [measureMode]);

  useEffect(() => {
    const line = measureLineRef.current;
    if (!line || !rulerPoints) return;
    let [a, b] = rulerPoints;
    if (a.time === b.time) {
      line.setData([]);
      return;
    }
    if (a.time > b.time) [a, b] = [b, a];
    line.setData([
      { time: a.time as any, value: a.price },
      { time: b.time as any, value: b.price },
    ]);
  }, [rulerPoints]);

  const { priceDelta, pct, bars, durationMs } = (() => {
    if (!rulerPoints) return { priceDelta: null, pct: null, bars: null, durationMs: null };
    const [a, b] = rulerPoints;
    if (a.time === b.time && a.price === b.price) return { priceDelta: null, pct: null, bars: null, durationMs: null };
    const delta = b.price - a.price;
    const pctVal = a.price !== 0 ? (delta / a.price) * 100 : 0;
    const { candles: sorted, toET } = sortedCandlesRef.current;
    const findNearest = (t: number) => {
      let best = -1, bestD = Infinity;
      sorted.forEach((c, i) => {
        const d = Math.abs(toET(c.t) - t);
        if (d < bestD) { bestD = d; best = i; }
      });
      return best;
    };
    const idxA = findNearest(a.time);
    const idxB = findNearest(b.time);
    const barsVal = idxA >= 0 && idxB >= 0 ? Math.abs(idxB - idxA) + 1 : null;
    const durationMsVal = Math.abs((b.time - a.time) * 1000);
    return { priceDelta: delta, pct: pctVal, bars: barsVal, durationMs: durationMsVal };
  })();

  const durationStr = durationMs != null
    ? durationMs >= 60000 ? `${Math.round(durationMs / 60000)}m` : `${Math.round(durationMs / 1000)}s`
    : '';

  if (!candles.length) return null;

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div style={{
        position: 'absolute', top: 8, left: 8, zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
        <button
          type="button"
          onClick={() => { setMeasureMode((m) => !m); if (measureMode) resetMeasure(); }}
          style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 600,
            background: measureMode ? '#ef4444' : '#1e293b',
            color: measureMode ? '#fff' : '#94a3b8',
            border: '1px solid #334155', borderRadius: 6, cursor: 'pointer',
          }}
        >
          Regla
        </button>
        {measureMode && (
          <span style={{ fontSize: 11, color: '#64748b' }}>Arrastra para medir</span>
        )}
        {priceDelta != null && (
          <>
            <span style={{
              fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
              color: priceDelta >= 0 ? '#22c55e' : '#ef4444',
              padding: '4px 10px', background: 'rgba(239,68,68,0.15)', borderRadius: 6, border: '1px solid #ef4444',
            }}>
              {priceDelta >= 0 ? '+' : ''}{priceDelta.toFixed(4)} ({pct != null && (pct >= 0 ? '+' : '')}{pct.toFixed(2)}%)
              {bars != null && ` · ${bars} barras`}
              {durationStr && ` · ${durationStr}`}
            </span>
            <button
              type="button"
              onClick={resetMeasure}
              style={{
                padding: '4px 8px', fontSize: 11, background: 'transparent',
                color: '#64748b', border: '1px solid #334155', borderRadius: 4, cursor: 'pointer',
              }}
            >
              Reset
            </button>
          </>
        )}
      </div>
      <div
        ref={containerRef}
        style={{ width: '100%', minHeight: height, cursor: measureMode ? 'crosshair' : 'default' }}
      />
    </div>
  );
}
