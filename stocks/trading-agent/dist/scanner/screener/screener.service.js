"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ScreenerService", {
    enumerable: true,
    get: function() {
        return ScreenerService;
    }
});
const _common = require("@nestjs/common");
const _rankingservice = require("./ranking/ranking.service");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
let ScreenerService = class ScreenerService {
    async getTopGappers() {
        return this.ranking.getTopGappers();
    }
    async getTopGainers() {
        return this.ranking.getTopGainers();
    }
    async getGainersDetailed() {
        const [session, intraday] = await Promise.all([
            this.ranking.getTopGainersSession(),
            this.ranking.getTopGainersIntraday()
        ]);
        return {
            session,
            intraday
        };
    }
    async getTopHighs() {
        return this.ranking.getTopHighs();
    }
    async getActiveSymbols() {
        return this.ranking.getCombinedSymbols();
    }
    async getActiveDetailed() {
        return this.ranking.getActiveRows();
    }
    async getStatus() {
        return this.ranking.getStatus();
    }
    async getCombinedSymbols() {
        return this.ranking.getCombinedSymbols();
    }
    async forceSync() {
        this.logger.log('Manual force sync triggered');
        return this.ranking.syncAllRankings();
    }
    constructor(ranking){
        this.ranking = ranking;
        this.logger = new _common.Logger(ScreenerService.name);
    }
};
ScreenerService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _rankingservice.RankingService === "undefined" ? Object : _rankingservice.RankingService
    ])
], ScreenerService);

//# sourceMappingURL=screener.service.js.map