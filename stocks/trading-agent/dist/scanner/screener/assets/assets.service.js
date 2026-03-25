"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AssetsService", {
    enumerable: true,
    get: function() {
        return AssetsService;
    }
});
const _common = require("@nestjs/common");
const _screenerrepository = require("../persistence/screener.repository");
const _alpacascreenerclient = require("../alpaca/alpaca-screener.client");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
function toBool(value, fallback) {
    if (value == null || value === '') return fallback;
    return [
        '1',
        'true',
        'yes',
        'y'
    ].includes(value.trim().toLowerCase());
}
let AssetsService = class AssetsService {
    async onModuleInit() {
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
            const filtered = raw.filter((a)=>{
                if (onlyActive && a.status !== 'active') return false;
                if (onlyUsEquity && a.class !== 'us_equity') return false;
                if (onlyTradable && !a.tradable) return false;
                if (excludeOtc && a.exchange === 'OTC') return false;
                return true;
            });
            const rows = filtered.map((a)=>({
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
                    maintenance_margin_requirement: a.maintenance_margin_requirement != null ? String(a.maintenance_margin_requirement) : null,
                    margin_requirement_long: a.margin_requirement_long != null ? String(a.margin_requirement_long) : null,
                    margin_requirement_short: a.margin_requirement_short != null ? String(a.margin_requirement_short) : null
                })).filter((r)=>Boolean(r.symbol));
            await this.repo.bulkInsertAssets(rows);
            this.logger.log(`screener_assets: inserted ${rows.length} symbols`);
        } catch (e) {
            this.logger.error(`Failed to populate screener_assets: ${e.message}`);
        }
    }
    async getAllSymbols() {
        const onlyActive = toBool(process.env.ONLY_ACTIVE, true);
        const onlyTradable = toBool(process.env.ONLY_TRADABLE, true);
        const excludeOtc = toBool(process.env.EXCLUDE_OTC_FROM_UNIVERSE, false);
        return this.repo.getUniverseSymbols({
            onlyActive,
            onlyTradable,
            excludeOtc
        });
    }
    constructor(repo, alpaca){
        this.repo = repo;
        this.alpaca = alpaca;
        this.logger = new _common.Logger(AssetsService.name);
    }
};
AssetsService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _screenerrepository.ScreenerRepository === "undefined" ? Object : _screenerrepository.ScreenerRepository,
        typeof _alpacascreenerclient.AlpacaScreenerClient === "undefined" ? Object : _alpacascreenerclient.AlpacaScreenerClient
    ])
], AssetsService);

//# sourceMappingURL=assets.service.js.map