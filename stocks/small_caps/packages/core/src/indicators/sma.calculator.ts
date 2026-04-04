export class SmaCalculator {
  /** Compute SMA for the given period. Returns null if not enough data. */
  static calculate(values: number[], period: number): number | null {
    if (values.length < period) return null;
    const slice = values.slice(-period);
    return slice.reduce((s, v) => s + v, 0) / period;
  }

  /** Compute full SMA line for chart overlay. */
  static calculateLine(values: number[], period: number): (number | null)[] {
    const result: (number | null)[] = [];
    for (let i = 0; i < values.length; i++) {
      if (i + 1 < period) {
        result.push(null);
      } else {
        const slice = values.slice(i + 1 - period, i + 1);
        result.push(slice.reduce((s, v) => s + v, 0) / period);
      }
    }
    return result;
  }
}
