/**
 * Gap percentage feature.
 * Single responsibility: compute gap_pct = (open_first - prior_close) / prior_close
 */

export function computeGapPct(priorClose: number, openFirst: number): number | null {
  if (priorClose <= 0) return null;
  return (openFirst - priorClose) / priorClose;
}