import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ScreenerRepository, type ScreenerAssetRow } from '../persistence/screener.repository';
import { AlpacaScreenerClient } from '../alpaca/alpaca-screener.client';

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'y'].includes(value.trim().toLowerCase());
}

@Injectable()
export class AssetsService implements OnModuleInit {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly repo: ScreenerRepository,
    private readonly alpaca: AlpacaScreenerClient,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.repo.ensureTables();
    const count = await this.repo.countAssets();
    if (count > 0) {
      this.logger.log(`screener_assets: ${count} rows (skip Alpaca assets fetch)`);
      return;
    }

    this.logger.log('screener_assets empty; downloading universe from Alpaca paper API...');
    try {
      const raw = await this.alpaca.fetchAllActiveUsEquityAssets();
      const onlyActive = toBool(process.env.ONLY_ACTIVE, true);
      const onlyTradable = toBool(process.env.ONLY_TRADABLE, true);
      const onlyUsEquity = toBool(process.env.ONLY_US_EQUITY, true);
      const excludeOtc = toBool(process.env.EXCLUDE_OTC_FROM_UNIVERSE, false);

      const filtered = raw.filter((a) => {
        if (onlyActive && a.status !== 'active') return false;
        if (onlyUsEquity && a.class !== 'us_equity') return false;
        if (onlyTradable && !a.tradable) return false;
        if (excludeOtc && a.exchange === 'OTC') return false;
        return true;
      });

      const rows: ScreenerAssetRow[] = filtered
        .map((a) => ({
          symbol: (a.symbol ?? '').trim().toUpperCase(),
          asset_id: a.id ?? '',
          class: a.class ?? 'us_equity',
          exchange: a.exchange ?? '',
          name: a.name ?? '',
          status: a.status ?? '',
          tradable: Boolean(a.tradable),
          marginable: Boolean(a.marginable),
          shortable: Boolean(a.shortable),
          easy_to_borrow: Boolean(a.easy_to_borrow),
          fractionable: Boolean(a.fractionable),
          maintenance_margin_requirement:
            a.maintenance_margin_requirement != null ? String(a.maintenance_margin_requirement) : null,
          margin_requirement_long: a.margin_requirement_long != null ? String(a.margin_requirement_long) : null,
          margin_requirement_short: a.margin_requirement_short != null ? String(a.margin_requirement_short) : null,
        }))
        .filter((r) => Boolean(r.symbol));

      await this.repo.bulkInsertAssets(rows);
      this.logger.log(`screener_assets: inserted ${rows.length} symbols`);
    } catch (e) {
      this.logger.error(`Failed to populate screener_assets: ${(e as Error).message}`);
    }
  }

  async getAllSymbols(): Promise<string[]> {
    const onlyActive = toBool(process.env.ONLY_ACTIVE, true);
    const onlyTradable = toBool(process.env.ONLY_TRADABLE, true);
    const excludeOtc = toBool(process.env.EXCLUDE_OTC_FROM_UNIVERSE, false);
    return this.repo.getUniverseSymbols({
      onlyActive,
      onlyTradable,
      excludeOtc,
    });
  }
}
