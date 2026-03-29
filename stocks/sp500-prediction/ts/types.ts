export type AlpacaBar = {
  t: string;   // timestamp ISO
  o: number;   // open
  h: number;   // high
  l: number;   // low
  c: number;   // close
  v: number;   // volume
  n?: number;  // trade count
  vw?: number; // VWAP
};
