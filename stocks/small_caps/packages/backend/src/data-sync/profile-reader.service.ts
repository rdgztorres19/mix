import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';

const PROFILE_CSV_PATHS = [
  // Primary: stock-training project CSV
  path.resolve(__dirname, '../../../../../stock-training/data/stock_profile.csv'),
];

interface ProfileRow {
  symbol: string;
  shares_outstanding: number | null;
  market_cap: number | null;
}

@Injectable()
export class ProfileReaderService {
  /** Read stock profiles from the existing CSV file. */
  async readProfiles(): Promise<ProfileRow[]> {
    for (const csvPath of PROFILE_CSV_PATHS) {
      try {
        const content = await fs.readFile(csvPath, 'utf-8');
        return this.parseCsv(content);
      } catch {
        // Try next path
      }
    }
    console.warn('  Warning: stock_profile.csv not found at any known location');
    return [];
  }

  private parseCsv(content: string): ProfileRow[] {
    const lines = content.trim().split('\n');
    if (lines.length < 2) return [];

    // Skip header: symbol,sharesOutstanding,marketCap
    const rows: ProfileRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const symbol = cols[0]?.trim();
      if (!symbol) continue;

      const sharesOutstanding = cols[1]?.trim() ? parseInt(cols[1].trim(), 10) : null;
      const marketCap = cols[2]?.trim() ? parseFloat(cols[2].trim()) : null;

      // Skip rows with no useful data
      if (sharesOutstanding == null && marketCap == null) continue;
      if (sharesOutstanding != null && !Number.isFinite(sharesOutstanding)) continue;
      if (marketCap != null && !Number.isFinite(marketCap)) continue;

      rows.push({
        symbol: symbol.toUpperCase(),
        shares_outstanding: sharesOutstanding,
        market_cap: marketCap,
      });
    }
    return rows;
  }
}
