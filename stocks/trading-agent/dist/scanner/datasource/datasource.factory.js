"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "StockDataSourceFactory", {
    enumerable: true,
    get: function() {
        return StockDataSourceFactory;
    }
});
const _common = require("@nestjs/common");
const _alpacadatasource = require("./alpaca-datasource");
const _momodatasource = require("./momo-datasource");
const _mysqldatasource = require("./mysql-datasource");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
let StockDataSourceFactory = class StockDataSourceFactory {
    getDataSource(dateStr) {
        // For today's data: use Alpaca Premium (no fallback - 61s historical fallback only)
        if (!dateStr || this.isToday(dateStr)) {
            return this.alpacaDataSource; // Alpaca only, MoMo fallback disabled
        }
        // For historical data: use MySQL (stock-training DB)
        return this.mysqlDataSource;
    }
    /** Dates available in MySQL (from stock-training sync). */ async getAvailableDates() {
        return this.mysqlDataSource.getAvailableDates();
    }
    isToday(dateStr) {
        const today = new Date().toLocaleDateString('en-CA', {
            timeZone: 'America/New_York'
        }); // YYYY-MM-DD
        return dateStr === today;
    }
    constructor(alpacaDataSource, momoDataSource, mysqlDataSource){
        this.alpacaDataSource = alpacaDataSource;
        this.momoDataSource = momoDataSource;
        this.mysqlDataSource = mysqlDataSource;
    }
};
StockDataSourceFactory = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _alpacadatasource.AlpacaDataSource === "undefined" ? Object : _alpacadatasource.AlpacaDataSource,
        typeof _momodatasource.MomoDataSource === "undefined" ? Object : _momodatasource.MomoDataSource,
        typeof _mysqldatasource.MysqlDataSource === "undefined" ? Object : _mysqldatasource.MysqlDataSource
    ])
], StockDataSourceFactory);

//# sourceMappingURL=datasource.factory.js.map