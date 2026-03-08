/**
 * Target classification label.
 * Binary: 1 if future_return_5m > threshold, 0 otherwise
 * Multi-class: +1 if R > +τ, -1 if R < -τ, 0 otherwise (neutral)
 */

export const TARGET_THRESHOLD = 0.025; // 2.5% — más estricto que 1.5% para reducir falsos positivos

export function computeTarget(futureReturn5m: number | null): number | null {
  if (futureReturn5m == null) return null;
  return futureReturn5m > TARGET_THRESHOLD ? 1 : 0;
}

/** Multi-class: +1 (alcista), -1 (bajista), 0 (neutral) según umbral τ */
export function computeTargetMulticlass(
  futureReturn5m: number | null,
  threshold: number
): number | null {
  if (futureReturn5m == null) return null;
  if (futureReturn5m > threshold) return 1;
  if (futureReturn5m < -threshold) return -1;
  return 0;
}
