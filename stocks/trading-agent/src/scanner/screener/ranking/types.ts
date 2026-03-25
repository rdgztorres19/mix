export interface Gapper {
  symbol: string;
  open: number;
  previousClose: number;
  gapPct: number;
  volume: number;
  rank: number;
}

export interface Gainer {
  symbol: string;
  close: number;
  previousClose: number;
  pctChange: number;
  volume: number;
  rank: number;
}

export interface RankingResult {
  gappers: Gapper[];
  gainers: Gainer[];
  combined: string[];
  updatedAt: string;
}
