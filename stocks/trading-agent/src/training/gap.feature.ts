// Duplicated from stock-training/src/features/gap.feature.ts - keep in sync for consistent features

export function computeGapPct(priorClose: number, openFirst: number): number | null {
  if (priorClose <= 0) return null;
  return (openFirst - priorClose) / priorClose;
}
