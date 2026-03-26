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
var ScreenerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScreenerService = void 0;
const common_1 = require("@nestjs/common");
const ranking_service_1 = require("./ranking/ranking.service");
let ScreenerService = ScreenerService_1 = class ScreenerService {
    constructor(ranking) {
        this.ranking = ranking;
        this.logger = new common_1.Logger(ScreenerService_1.name);
    }
    async getTopGappers() {
        return this.ranking.getTopGappers();
    }
    async getTopGainers() {
        return this.ranking.getTopGainers();
    }
    async getGainersDetailed() {
        const [session, intraday] = await Promise.all([
            this.ranking.getTopGainersSession(),
            this.ranking.getTopGainersIntraday(),
        ]);
        return { session, intraday };
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
};
exports.ScreenerService = ScreenerService;
exports.ScreenerService = ScreenerService = ScreenerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [ranking_service_1.RankingService])
], ScreenerService);
//# sourceMappingURL=screener.service.js.map