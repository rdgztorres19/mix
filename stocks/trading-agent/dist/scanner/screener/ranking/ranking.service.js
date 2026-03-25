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
const _alpacabatchservice = require("../batch/alpaca-batch.service");
const _assetsservice = require("../assets/assets.service");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
let RankingService = class RankingService {
    // Placeholder: implement logic to get top gappers
    async getTopGappers() {
        // ...fetch from DB/cache or calculate
        return [];
    }
    // Placeholder: implement logic to get top gainers
    async getTopGainers() {
        // ...fetch from DB/cache or calculate
        return [];
    }
    // Placeholder: implement logic to get combined symbols
    async getCombinedSymbols() {
        // ...merge and dedupe
        return [];
    }
    // Placeholder: sync all rankings (batch fetch, recalc, store)
    async syncAllRankings() {
        // ...fetch assets, batch request to Alpaca, recalc rankings, store in DB/cache
        this.logger.log('Syncing all rankings (force/manual)');
        return {
            status: 'ok',
            updated: true
        };
    }
    constructor(alpacaBatch, assets){
        this.alpacaBatch = alpacaBatch;
        this.assets = assets;
        this.logger = new _common.Logger(RankingService.name);
    }
};
RankingService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _alpacabatchservice.AlpacaBatchService === "undefined" ? Object : _alpacabatchservice.AlpacaBatchService,
        typeof _assetsservice.AssetsService === "undefined" ? Object : _assetsservice.AssetsService
    ])
], RankingService);

//# sourceMappingURL=ranking.service.js.map