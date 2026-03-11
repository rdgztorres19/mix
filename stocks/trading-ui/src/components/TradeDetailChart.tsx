import { useEffect, useRef } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
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
  const priceLineRefs = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]>([]);

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
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
      priceLineRefs.current = [];
    };
  }, [height]);

  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || !volSeriesRef.current || !candles.length) return;

    const sampleDate = new Date(candles[0].t);
    const utcStr = sampleDate.toLocaleString('en-US', { timeZone: 'UTC', hour12: false });
    const etStr = sampleDate.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
    const etOffsetSec = (new Date(etStr).getTime() - new Date(utcStr).getTime()) / 1000;
    const toET = (utcMs: number) => Math.floor(utcMs / 1000) + etOffsetSec;

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

  if (!candles.length) return null;

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', minHeight: height }}
    />
  );
}
