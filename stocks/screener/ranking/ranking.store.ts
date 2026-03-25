import { Gapper, Gainer, RankingResult } from './types';

export class RankingStore {
  private gappers: Gapper[] = [];
  private gainers: Gainer[] = [];
  private combined: string[] = [];
  private updatedAt: string = '';

  set(result: RankingResult) {
    this.gappers = result.gappers;
    this.gainers = result.gainers;
    this.combined = result.combined;
    this.updatedAt = result.updatedAt;
  }

  getGappers() {
    return this.gappers;
  }

  getGainers() {
    return this.gainers;
  }

  getCombined() {
    return this.combined;
  }

  getUpdatedAt() {
    return this.updatedAt;
  }
}
