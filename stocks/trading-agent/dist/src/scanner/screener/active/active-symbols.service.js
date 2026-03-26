"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var ActiveSymbolsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActiveSymbolsService = void 0;
const common_1 = require("@nestjs/common");
const screener_repository_1 = require("../persistence/screener.repository");
const RANK_TYPES_FOR_ACTIVE = [
    'gapper',
    'gainer_intraday',
    'gainer_session',
    'high_session',
    'high_current',
];
function toPositiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
let ActiveSymbolsService = ActiveSymbolsService_1 = class ActiveSymbolsService {
    constructor(repo) {
        this.repo = repo;
        this.logger = new common_1.Logger(ActiveSymbolsService_1.name);
    }
    topN() {
        return toPositiveInt(process.env.SCREENER_TOP_N, 40);
    }
    async rebuildFromStoredRanks() {
        const n = this.topN();
        const bySymbol = new Map();
        for (const rt of RANK_TYPES_FOR_ACTIVE) {
            const rows = await this.repo.getRankRows(rt);
            const slice = rows.slice(0, n);
            for (const r of slice) {
                const sym = r.symbol.toUpperCase();
                const prev = bySymbol.get(sym) ?? 0;
                const score = Math.max(prev, Math.abs(r.metric_value));
                bySymbol.set(sym, score);
            }
        }
        const sorted = [...bySymbol.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, n);
        const entries = sorted.map(([symbol, score], i) => ({
            rank_order: i + 1,
            symbol,
            score,
        }));
        await this.repo.replaceActiveSymbols(entries);
        this.logger.log(`active symbols updated: ${entries.length}`);
        return { count: entries.length };
    }
    async getActive() {
        return this.repo.getActiveSymbols();
    }
};
exports.ActiveSymbolsService = ActiveSymbolsService;
exports.ActiveSymbolsService = ActiveSymbolsService = ActiveSymbolsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [screener_repository_1.ScreenerRepository])
], ActiveSymbolsService);
//# sourceMappingURL=active-symbols.service.js.map