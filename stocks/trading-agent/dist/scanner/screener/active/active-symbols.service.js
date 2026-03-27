"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ActiveSymbolsService", {
    enumerable: true,
    get: function() {
        return ActiveSymbolsService;
    }
});
const _common = require("@nestjs/common");
const _screenerrepository = require("../persistence/screener.repository");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
const RANK_TYPES_FOR_ACTIVE = [
    'gapper',
    'gainer_intraday',
    'gainer_session',
    'high_session',
    'high_current'
];
function toPositiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
let ActiveSymbolsService = class ActiveSymbolsService {
    topN() {
        return toPositiveInt(process.env.SCREENER_TOP_N, 40);
    }
    async rebuildFromStoredRanks(sessionDate) {
        const n = this.topN();
        const bySymbol = new Map();
        for (const rt of RANK_TYPES_FOR_ACTIVE){
            const rows = await this.repo.getRankRows(rt);
            const slice = rows.slice(0, n);
            for (const r of slice){
                const sym = r.symbol.toUpperCase();
                const prev = bySymbol.get(sym) ?? 0;
                const score = Math.max(prev, Math.abs(r.metric_value));
                bySymbol.set(sym, score);
            }
        }
        const sorted = [
            ...bySymbol.entries()
        ].sort((a, b)=>b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
        const entries = sorted.map(([symbol, score], i)=>({
                rank_order: i + 1,
                symbol,
                score
            }));
        await this.repo.replaceActiveSymbols(entries, sessionDate);
        this.logger.log(`active symbols updated: ${entries.length}`);
        return {
            count: entries.length
        };
    }
    async getActive(sessionDate) {
        return this.repo.getActiveSymbols(sessionDate);
    }
    constructor(repo){
        this.repo = repo;
        this.logger = new _common.Logger(ActiveSymbolsService.name);
    }
};
ActiveSymbolsService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _screenerrepository.ScreenerRepository === "undefined" ? Object : _screenerrepository.ScreenerRepository
    ])
], ActiveSymbolsService);

//# sourceMappingURL=active-symbols.service.js.map