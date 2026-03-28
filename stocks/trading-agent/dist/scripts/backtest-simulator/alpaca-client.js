"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AlpacaClient", {
    enumerable: true,
    get: function() {
        return AlpacaClient;
    }
});
const BARS_URL = 'https://data.alpaca.markets/v2/stocks/bars';
function sleep(ms) {
    return new Promise((resolve)=>setTimeout(resolve, ms));
}
function getEnvAny(keys) {
    for (const k of keys){
        const v = process.env[k];
        if (v) return v;
    }
    return '';
}
function marketDataHeaders() {
    const key = getEnvAny([
        'ALPACA_API_KEY_ID',
        'ALPACA_KEY_ID'
    ]);
    const secret = getEnvAny([
        'ALPACA_API_SECRET_KEY',
        'ALPACA_SECRET_KEY'
    ]);
    return {
        'APCA-API-KEY-ID': key,
        'APCA-API-SECRET-KEY': secret,
        Accept: 'application/json'
    };
}
let AlpacaClient = class AlpacaClient {
    async fetch1mBars(symbols, date) {
        const result = new Map();
        const chunks = this.chunk(symbols, this.chunkSize);
        for(let i = 0; i < chunks.length; i++){
            console.log(`  [Alpaca] Fetching 1m bars chunk ${i + 1}/${chunks.length} (${chunks[i].length} symbols)...`);
            const chunkResult = await this.fetchBarsChunk(chunks[i], date, date, '1Min');
            for (const [sym, bars] of Object.entries(chunkResult)){
                result.set(sym.toUpperCase(), bars);
            }
        }
        return result;
    }
    async fetchUniverse1mBars(symbols, date) {
        const result = new Map();
        const chunks = this.chunk(symbols, this.chunkSize);
        let totalBars = 0;
        const t0 = Date.now();
        for(let i = 0; i < chunks.length; i++){
            const ct = Date.now();
            const chunkResult = await this.fetchBarsChunk(chunks[i], date, date, '1Min');
            let chunkBars = 0;
            for (const [sym, bars] of Object.entries(chunkResult)){
                result.set(sym.toUpperCase(), bars);
                chunkBars += bars.length;
            }
            totalBars += chunkBars;
            const elapsed = ((Date.now() - ct) / 1000).toFixed(1);
            console.log(`  [Alpaca] Chunk ${i + 1}/${chunks.length}: ` + `${Object.keys(chunkResult).length} symbols, ${chunkBars} bars (${elapsed}s)`);
        }
        const totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`  [Alpaca] Universe fetch done: ${result.size} symbols, ${totalBars} bars in ${totalElapsed}s`);
        return result;
    }
    async fetchDailyBars(symbols, date) {
        const result = new Map();
        const chunks = this.chunk(symbols, 1000);
        for(let i = 0; i < chunks.length; i++){
            console.log(`  [Alpaca] Fetching daily bars chunk ${i + 1}/${chunks.length} (${chunks[i].length} symbols)...`);
            const chunkResult = await this.fetchBarsChunk(chunks[i], date, date, '1Day');
            for (const [sym, bars] of Object.entries(chunkResult)){
                result.set(sym.toUpperCase(), bars);
            }
        }
        return result;
    }
    async fetchBarsChunk(symbols, startDate, endDate, timeframe) {
        const merged = {};
        let pageToken = null;
        do {
            const params = new URLSearchParams({
                symbols: symbols.join(','),
                timeframe,
                start: `${startDate}T00:00:00Z`,
                end: `${endDate}T23:59:59Z`,
                adjustment: 'split',
                sort: 'asc',
                limit: '10000'
            });
            if (pageToken) params.set('page_token', pageToken);
            const data = await this.fetchWithRetry(`${BARS_URL}?${params}`);
            const bars = data.bars ?? {};
            for (const [sym, barArr] of Object.entries(bars)){
                const key = sym.toUpperCase();
                if (!merged[key]) merged[key] = [];
                merged[key].push(...barArr);
            }
            pageToken = data.next_page_token ?? null;
        }while (pageToken)
        return merged;
    }
    async fetchWithRetry(url) {
        for(let attempt = 1; attempt <= this.maxRetries; attempt++){
            const res = await fetch(url, {
                headers: marketDataHeaders()
            });
            if (res.ok) return await res.json();
            if (res.status === 429) {
                console.warn(`  [Alpaca] Rate limited (429). Waiting 60s... (attempt ${attempt})`);
                await sleep(60_000);
                continue;
            }
            if (res.status >= 500) {
                const wait = Math.min(5000 * attempt, 60_000);
                console.warn(`  [Alpaca] Server error ${res.status}. Retrying in ${wait / 1000}s...`);
                await sleep(wait);
                continue;
            }
            throw new Error(`Alpaca HTTP ${res.status}: ${await res.text()}`);
        }
        throw new Error(`Alpaca: max retries (${this.maxRetries}) exceeded`);
    }
    chunk(arr, size) {
        const result = [];
        for(let i = 0; i < arr.length; i += size){
            result.push(arr.slice(i, i + size));
        }
        return result;
    }
    constructor(){
        this.chunkSize = parseInt(process.env.SCREENER_CHUNK_SIZE ?? '500', 10);
        this.maxRetries = parseInt(process.env.SCREENER_MAX_RETRIES ?? '20', 10);
    }
};

//# sourceMappingURL=alpaca-client.js.map