"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "RankingService", {
    enumerable: true,
    get: function() {
        return RankingService;
    }
});
const _common = require("@nestjs/common");
const _promisepool = require("@supercharge/promise-pool");
const _alpacascreenerclient = require("../alpaca/alpaca-screener.client");
const _screenerrepository = require("../persistence/screener.repository");
const _assetsservice = require("../assets/assets.service");
const _activesymbolsservice = require("../active/active-symbols.service");
const _ettime = require("../utils/et-time");
const _screenerrankers = require("./rankers/screener-rankers");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
function toPositiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
function chunkArray(arr, size) {
    const out = [];
    for(let i = 0; i < arr.length; i += size)out.push(arr.slice(i, i + size));
    return out;
}
function minusCalendarDays(ymd, days) {
    const d = new Date(`${ymd}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
}
let RankingService = class RankingService {
    chunkSize() {
        return toPositiveInt(process.env.SCREENER_CHUNK_SIZE, 1000);
    }
    concurrency() {
        return toPositiveInt(process.env.SCREENER_CHUNK_CONCURRENCY, 5);
    }
    topN() {
        return toPositiveInt(process.env.SCREENER_TOP_N, 40);
    }
    volumenRequired() {
        return toPositiveInt(process.env.SCREENER_VOLUMEN_REQUIRED, 500000);
    }
    async getTopGappers() {
        return this.repo.getRankRows('gapper');
    }
    async getTopGainersSession() {
        return this.repo.getRankRows('gainer_session');
    }
    async getTopGainersIntraday() {
        return this.repo.getRankRows('gainer_intraday');
    }
    /** Back-compat: session gainers as primary list */ async getTopGainers() {
        return this.getTopGainersSession();
    }
    async getTopHighs() {
        const [session, current] = await Promise.all([
            this.repo.getRankRows('high_session'),
            this.repo.getRankRows('high_current')
        ]);
        return {
            session,
            current
        };
    }
    async getCombinedSymbols() {
        const rows = await this.activeSymbols.getActive((0, _ettime.getEtYYYYMMDD)());
        return rows.map((r)=>r.symbol);
    }
    async getActiveRows() {
        return this.activeSymbols.getActive((0, _ettime.getEtYYYYMMDD)());
    }
    async getStatus() {
        const m = await this.repo.getRunMeta();
        return {
            last_run_utc: m?.last_run_utc?.toISOString() ?? null,
            last_session_date: m?.last_session_date ?? null,
            symbols_scanned: m?.symbols_scanned ?? null,
            note: m?.note ?? null
        };
    }
    /**
   * Full pipeline: prev-close backfill, snapshots (PromisePool), ranks, quote cache, active set.
   */ async syncAllRankings() {
        if (this.fullSyncInFlight) return this.fullSyncInFlight;
        this.fullSyncInFlight = this.runPipeline({
            full: true
        });
        try {
            return await this.fullSyncInFlight;
        } finally{
            this.fullSyncInFlight = null;
        }
    }
    /** Post-market: refresh quote snapshots only (no rank recompute). */ async refreshQuoteCacheOnly() {
        const r = await this.runPipeline({
            full: false
        });
        return {
            status: r.status,
            symbols: r.symbols
        };
    }
    async mergeSnapshots(universe) {
        const chunks = chunkArray(universe, this.chunkSize());
        const merged = {};
        const conc = this.concurrency();
        await _promisepool.PromisePool.withConcurrency(conc).for(chunks).process(async (chunk)=>{
            const part = await this.alpaca.fetchSnapshotsForChunk(chunk);
            Object.assign(merged, part);
        });
        return merged;
    }
    async ensurePrevCloseCache(universe, sessionDate) {
        if (this.prevCloseCacheSessionDate === sessionDate && this.prevCloseCache) {
            this.logger.debug(`prev_close cache hit for ${sessionDate}`);
            return this.prevCloseCache;
        }
        if (this.prevCloseCacheSessionDate === sessionDate && this.prevCloseCachePromise) {
            this.logger.debug(`prev_close cache in-flight wait for ${sessionDate}`);
            return this.prevCloseCachePromise;
        }
        this.prevCloseCacheSessionDate = sessionDate;
        const t0 = Date.now();
        this.prevCloseCachePromise = (async ()=>{
            this.logger.log(`prev_close cache build start for ${sessionDate}`);
            let map = await this.repo.getPrevCloseMapForDate(sessionDate);
            const missing = universe.filter((s)=>!map.has(s.toUpperCase()));
            this.logger.log(`prev_close cache for ${sessionDate}: have=${map.size} missing=${missing.length} universe=${universe.length}`);
            if (!missing.length) return map;
            const paddedStart = minusCalendarDays(sessionDate, 10);
            const chunks = chunkArray(missing, this.chunkSize());
            const conc = this.concurrency();
            this.logger.warn(`prev_close cache backfill needed (${missing.length} symbols) -> chunks=${chunks.length} conc=${conc}`);
            const upserts = [];
            await _promisepool.PromisePool.withConcurrency(conc).for(chunks).process(async (chunk)=>{
                const barsBySymbol = await this.alpaca.fetchDailyBarsForChunk(chunk, paddedStart, sessionDate);
                for (const sym of chunk){
                    const bars = barsBySymbol[sym] ?? barsBySymbol[sym.toUpperCase()] ?? [];
                    const pc = (0, _screenerrankers.barsPrevCloseBeforeSession)(bars, sessionDate);
                    // Negative caching:
                    // If Alpaca doesn't return bars for the symbol (or doesn't contain a valid prev close yet),
                    // store a sentinel to avoid re-calling Alpaca on every 1-minute tick.
                    //
                    // Rankers treat prevClose <= 0 as invalid, so this won't create rankings from bad data.
                    upserts.push({
                        symbol: sym.toUpperCase(),
                        prevClose: pc ?? -1
                    });
                }
            });
            if (upserts.length) {
                this.logger.log(`prev_close upsert batch: ${upserts.length} rows for ${sessionDate}`);
                await this.repo.upsertPrevClosesBatch(sessionDate, 'alpaca_bar', upserts);
                for (const e of upserts)map.set(e.symbol.toUpperCase(), e.prevClose);
            }
            this.logger.log(`prev_close cache build done for ${sessionDate} (${Date.now() - t0}ms)`);
            return map;
        })();
        try {
            const m = await this.prevCloseCachePromise;
            this.prevCloseCache = m;
            return m;
        } finally{
            this.prevCloseCachePromise = null;
        }
    }
    async persistQuotesBatch(snapshots) {
        const entries = [];
        for (const [symbol, item] of Object.entries(snapshots)){
            const d = item?.dailyBar;
            if (!d) continue;
            const last = item.latestTrade?.p ?? d.c;
            entries.push({
                symbol,
                lastPrice: Number.isFinite(last) ? last : null,
                dayHigh: Number.isFinite(d.h) ? d.h : null,
                dayLow: Number.isFinite(d.l) ? d.l : null,
                dayClose: Number.isFinite(d.c) ? d.c : null,
                volume: d.v != null ? Number(d.v) : null
            });
        }
        await this.repo.upsertQuoteSnapshotsBatch(entries);
    }
    async runPipeline(opts) {
        const sessionDate = (0, _ettime.getEtYYYYMMDD)();
        const universe = await this.assets.getAllSymbols();
        if (!universe.length) {
            this.logger.warn('screener universe empty; skip sync');
            await this.repo.updateRunMeta(sessionDate, 0, 'empty_universe');
            return {
                status: 'ok',
                symbols: 0,
                ranks: false
            };
        }
        const prevMap = opts.full ? await this.ensurePrevCloseCache(universe, sessionDate) : new Map();
        const snapshots = await this.mergeSnapshots(universe);
        if (opts.full) {
            const n = this.topN();
            const minVol = this.volumenRequired();
            const lists = [
                {
                    type: 'gapper',
                    rows: (0, _screenerrankers.rankTopGappers)(snapshots, sessionDate, prevMap, n, minVol)
                },
                {
                    type: 'gainer_session',
                    rows: (0, _screenerrankers.rankTopGainersSession)(snapshots, sessionDate, prevMap, n, minVol)
                },
                {
                    type: 'gainer_intraday',
                    rows: (0, _screenerrankers.rankTopGainersIntraday)(snapshots, sessionDate, prevMap, n, minVol)
                },
                {
                    type: 'high_session',
                    rows: (0, _screenerrankers.rankTopHighSession)(snapshots, sessionDate, prevMap, n, minVol)
                },
                {
                    type: 'high_current',
                    rows: (0, _screenerrankers.rankTopHighCurrent)(snapshots, sessionDate, prevMap, n, minVol)
                }
            ];
            for (const { type, rows } of lists){
                await this.repo.replaceRankRows(type, rows);
            }
            await this.activeSymbols.rebuildFromStoredRanks(sessionDate);
        }
        await this.persistQuotesBatch(snapshots);
        await this.repo.updateRunMeta(sessionDate, universe.length, opts.full ? 'full_rank+quotes' : 'quotes_only');
        return {
            status: 'ok',
            symbols: universe.length,
            ranks: opts.full
        };
    }
    constructor(alpaca, assets, repo, activeSymbols){
        this.alpaca = alpaca;
        this.assets = assets;
        this.repo = repo;
        this.activeSymbols = activeSymbols;
        this.logger = new _common.Logger(RankingService.name);
        // Cache in-memory por `sessionDate` para evitar leer prev_close desde MySQL
        // en cada tick (cron cada 1 minuto).
        this.prevCloseCacheSessionDate = null;
        this.prevCloseCache = null;
        this.prevCloseCachePromise = null;
        this.fullSyncInFlight = null;
    }
};
RankingService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _alpacascreenerclient.AlpacaScreenerClient === "undefined" ? Object : _alpacascreenerclient.AlpacaScreenerClient,
        typeof _assetsservice.AssetsService === "undefined" ? Object : _assetsservice.AssetsService,
        typeof _screenerrepository.ScreenerRepository === "undefined" ? Object : _screenerrepository.ScreenerRepository,
        typeof _activesymbolsservice.ActiveSymbolsService === "undefined" ? Object : _activesymbolsservice.ActiveSymbolsService
    ])
], RankingService);

//# sourceMappingURL=ranking.service.js.map