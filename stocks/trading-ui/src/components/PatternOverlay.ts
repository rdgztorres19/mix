import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { PatternPoint } from '../types';

/** Colors for pattern markers and price lines on the chart. */
const COLORS = {
  entry: '#22c55e',
  stop: '#ef4444',
  target: '#a78bfa',
  pattern: '#f59e0b',
};

/** Manages entry/stop/target price lines and pattern anchor markers on a chart. */
export class PatternOverlay {
  private priceLines: Array<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>> = [];
  private markers: Array<{ time: number; position: string; color: string; shape: string; text: string }> = [];

  /**
   * Draw entry, stop, and target horizontal price lines on the candlestick series.
   * Also draws pattern anchor markers if provided.
   */
  apply(
    chart: IChartApi,
    series: ISeriesApi<'Candlestick'>,
    opts: {
      entry: number | null;
      stop: number | null;
      target1: number | null;
      target2: number | null;
      patternPoints?: PatternPoint[];
    },
  ): void {
    this.clear(series);

    // Price lines for entry/stop/targets
    if (opts.entry) {
      this.priceLines.push(
        series.createPriceLine({
          price: opts.entry,
          color: COLORS.entry,
          lineWidth: 1,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: 'Entry',
        }),
      );
    }
    if (opts.stop) {
      this.priceLines.push(
        series.createPriceLine({
          price: opts.stop,
          color: COLORS.stop,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'Stop',
        }),
      );
    }
    if (opts.target1) {
      this.priceLines.push(
        series.createPriceLine({
          price: opts.target1,
          color: COLORS.target,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'T1',
        }),
      );
    }
    if (opts.target2) {
      this.priceLines.push(
        series.createPriceLine({
          price: opts.target2,
          color: COLORS.target,
          lineWidth: 1,
          lineStyle: 3, // Dotted
          axisLabelVisible: true,
          title: 'T2',
        }),
      );
    }

    // Pattern markers (e.g. A, B, C, D for ABCD; PoleStart, PoleHigh, FlagLow for Bull Flag)
    if (opts.patternPoints?.length) {
      const sorted = [...opts.patternPoints].sort((a, b) => a.time - b.time);
      const markerData = sorted.map((p) => ({
        time: Math.floor(p.time / 1000) as any,
        position: p.price >= (opts.entry ?? p.price) ? 'aboveBar' as const : 'belowBar' as const,
        color: COLORS.pattern,
        shape: 'circle' as const,
        text: p.label,
      }));
      series.setMarkers(markerData as any);
      this.markers = markerData;
    }
  }

  /** Remove all price lines and markers. */
  clear(series: ISeriesApi<'Candlestick'>): void {
    for (const pl of this.priceLines) {
      series.removePriceLine(pl);
    }
    this.priceLines = [];
    if (this.markers.length) {
      series.setMarkers([]);
      this.markers = [];
    }
  }
}
