export class EmaCalculator {
  /** Compute EMA for the given period. Returns null if not enough data. */
  static calculate(values: number[], period: number): number | null {
    if (!values.length) return null;
    if (values.length < period) {
      return values.reduce((s, v) => s + v, 0) / values.length;
    }
    const k = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
    }
    return ema;
  }

  /** Compute full EMA line for chart overlay. */
  static calculateLine(values: number[], period: number): (number | null)[] {
    const result: (number | null)[] = [];
    if (!values.length) return result;

    for (let i = 0; i < values.length; i++) {
      if (i + 1 < period) {
        result.push(null);
      } else {
        result.push(this.calculate(values.slice(0, i + 1), period));
      }
    }
    return result;
  }
}
