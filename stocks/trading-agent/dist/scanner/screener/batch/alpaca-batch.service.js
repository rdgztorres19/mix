"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AlpacaBatchService", {
    enumerable: true,
    get: function() {
        return AlpacaBatchService;
    }
});
const _common = require("@nestjs/common");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
let AlpacaBatchService = class AlpacaBatchService {
    // Batch request to Alpaca API for symbols, chunked and concurrent
    async fetchBatchData(symbols, fetcher, chunkSize = 200, concurrency = 5) {
        const results = [];
        const chunks = [];
        for(let i = 0; i < symbols.length; i += chunkSize){
            chunks.push(symbols.slice(i, i + chunkSize));
        }
        let idx = 0;
        const runChunk = async ()=>{
            while(idx < chunks.length){
                const myIdx = idx++;
                try {
                    const res = await fetcher(chunks[myIdx]);
                    results.push(res);
                } catch (e) {
                    this.logger.error(`Batch chunk ${myIdx} failed`, e);
                }
            }
        };
        await Promise.all(Array.from({
            length: Math.min(concurrency, chunks.length)
        }, runChunk));
        return results;
    }
    constructor(){
        this.logger = new _common.Logger(AlpacaBatchService.name);
    }
};
AlpacaBatchService = _ts_decorate([
    (0, _common.Injectable)()
], AlpacaBatchService);

//# sourceMappingURL=alpaca-batch.service.js.map