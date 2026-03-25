export interface AlpacaBar {
  t: string; // ISO date
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
}

export interface AlpacaSnapshotBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface AlpacaSnapshotItem {
  dailyBar?: AlpacaSnapshotBar;
  prevDailyBar?: AlpacaSnapshotBar;
}

export type AlpacaSnapshotsResponse = Record<string, AlpacaSnapshotItem>;
