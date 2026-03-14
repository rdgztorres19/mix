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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var PredictorController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PredictorController = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const rxjs_1 = require("rxjs");
const predictor_service_1 = require("./predictor.service");
class CandleDto {
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CandleDto.prototype, "t", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CandleDto.prototype, "o", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CandleDto.prototype, "h", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CandleDto.prototype, "l", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CandleDto.prototype, "c", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CandleDto.prototype, "v", void 0);
class PredictDto {
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => CandleDto),
    __metadata("design:type", Array)
], PredictDto.prototype, "candles", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "target_idx", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "atr", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "high_of_day", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "low_of_day", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "pre_market_high", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "change_pct_at_candle", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PredictDto.prototype, "ticker", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PredictDto.prototype, "date", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PredictDto.prototype, "candle_time_et", void 0);
let PredictorController = PredictorController_1 = class PredictorController {
    constructor(predictor) {
        this.predictor = predictor;
        this.logger = new common_1.Logger(PredictorController_1.name);
    }
    async predict(body, thresholdStr) {
        console.time(`Predict`);
        const threshold = thresholdStr ? parseFloat(thresholdStr) : 0.3;
        if (isNaN(threshold) || threshold < 0 || threshold > 1) {
            throw new common_1.HttpException('threshold must be between 0 and 1', common_1.HttpStatus.BAD_REQUEST);
        }
        this.logger.log(`POST /predict threshold=${threshold}`);
        try {
            const result = await this.predictor.predict(body, threshold);
            return result;
        }
        catch (err) {
            this.logger.error(`Predict failed: ${err.message}`);
            throw new common_1.HttpException(`Predict failed: ${err.message}`, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
        finally {
            console.timeEnd(`Predict`);
        }
    }
    async evaluate(thresholdStr) {
        const threshold = thresholdStr ? parseFloat(thresholdStr) : 0.5;
        if (isNaN(threshold) || threshold < 0 || threshold > 1) {
            throw new common_1.HttpException('threshold must be between 0 and 1', common_1.HttpStatus.BAD_REQUEST);
        }
        this.logger.log(`GET /predict/evaluate threshold=${threshold}`);
        try {
            const result = await this.predictor.evaluate(threshold);
            return result;
        }
        catch (err) {
            this.logger.error(`Evaluate failed: ${err.message}`);
            throw new common_1.HttpException(`Evaluate failed: ${err.message}`, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async getBacktestCandles(ticker, date, fromTime, countStr) {
        if (!ticker || !date || !fromTime) {
            throw new common_1.HttpException('ticker, date and fromTime are required', common_1.HttpStatus.BAD_REQUEST);
        }
        const count = countStr ? parseInt(countStr, 10) : 12;
        if (isNaN(count) || count < 1 || count > 50) {
            throw new common_1.HttpException('count must be 1–50', common_1.HttpStatus.BAD_REQUEST);
        }
        try {
            return this.predictor.getBacktestCandles(ticker, date, fromTime, count);
        }
        catch (err) {
            this.logger.error(`getBacktestCandles failed: ${err.message}`);
            throw new common_1.HttpException(err.message || 'Failed to fetch candles', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    backtestStream(ticker, date, fromTime, toTime, thresholdStr, investmentStr, tpPctStr, slPctStr, lookAheadStr) {
        if (!ticker || !date) {
            throw new common_1.HttpException('ticker and date are required', common_1.HttpStatus.BAD_REQUEST);
        }
        const threshold = thresholdStr ? parseFloat(thresholdStr) : 0.6;
        const investment = investmentStr ? parseFloat(investmentStr) : 200;
        const tpPct = tpPctStr ? parseFloat(tpPctStr) : 1.5;
        const slPct = slPctStr ? parseFloat(slPctStr) : 1.5;
        const lookAhead = lookAheadStr ? Math.max(1, Math.min(60, parseInt(lookAheadStr, 10) || 10)) : 10;
        this.logger.log(`SSE /predict/backtest/stream ${ticker} ${date} ${fromTime ?? '09:30'}-${toTime ?? '16:00'} thr=${threshold} TP=${tpPct}% SL=${slPct}% lookAhead=${lookAhead}`);
        return this.predictor.backtestStream(ticker, date, fromTime ?? '09:30', toTime ?? '16:00', threshold, investment, tpPct, slPct, lookAhead);
    }
    backtestStreamDay(date, symbolsParam, fromTime, toTime, thresholdStr, investmentStr, tpPctStr, slPctStr, lookAheadStr) {
        if (!date) {
            throw new common_1.HttpException('date is required', common_1.HttpStatus.BAD_REQUEST);
        }
        const symbols = symbolsParam
            ? symbolsParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
            : undefined;
        const threshold = thresholdStr ? parseFloat(thresholdStr) : 0.6;
        const investment = investmentStr ? parseFloat(investmentStr) : 200;
        const tpPct = tpPctStr ? parseFloat(tpPctStr) : 1.5;
        const slPct = slPctStr ? parseFloat(slPctStr) : 1.5;
        const lookAhead = lookAheadStr ? Math.max(1, Math.min(60, parseInt(lookAheadStr, 10) || 10)) : 10;
        this.logger.log(`SSE /predict/backtest/stream-day ${date} symbols=${symbols?.length ?? 'mysql'} ${fromTime ?? '09:30'}-${toTime ?? '16:00'} thr=${threshold} TP=${tpPct}% SL=${slPct}% lookAhead=${lookAhead}`);
        return this.predictor.backtestStreamDay(date, fromTime ?? '09:30', toTime ?? '16:00', threshold, investment, tpPct, slPct, lookAhead, symbols);
    }
    async backtest(body) {
        const { ticker, date, fromTime = '09:30', toTime = '16:00' } = body;
        const threshold = body.threshold ?? 0.6;
        const investment = body.investment ?? 200;
        if (!ticker || !date) {
            throw new common_1.HttpException('ticker and date are required', common_1.HttpStatus.BAD_REQUEST);
        }
        this.logger.log(`POST /predict/backtest ${ticker} ${date} ${fromTime}-${toTime} thr=${threshold}`);
        try {
            const result = await this.predictor.backtest(ticker, date, fromTime, toTime, threshold, investment);
            if (result.error) {
                throw new common_1.HttpException(result.error, common_1.HttpStatus.NOT_FOUND);
            }
            return result;
        }
        catch (err) {
            if (err instanceof common_1.HttpException)
                throw err;
            this.logger.error(`Backtest failed: ${err.message}`);
            throw new common_1.HttpException(`Backtest failed: ${err.message}`, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
};
exports.PredictorController = PredictorController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Query)('threshold')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [PredictDto, String]),
    __metadata("design:returntype", Promise)
], PredictorController.prototype, "predict", null);
__decorate([
    (0, common_1.Get)('evaluate'),
    __param(0, (0, common_1.Query)('threshold')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PredictorController.prototype, "evaluate", null);
__decorate([
    (0, common_1.Get)('backtest-candles'),
    __param(0, (0, common_1.Query)('ticker')),
    __param(1, (0, common_1.Query)('date')),
    __param(2, (0, common_1.Query)('fromTime')),
    __param(3, (0, common_1.Query)('count')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", Promise)
], PredictorController.prototype, "getBacktestCandles", null);
__decorate([
    (0, common_1.Sse)('backtest/stream'),
    __param(0, (0, common_1.Query)('ticker')),
    __param(1, (0, common_1.Query)('date')),
    __param(2, (0, common_1.Query)('fromTime')),
    __param(3, (0, common_1.Query)('toTime')),
    __param(4, (0, common_1.Query)('threshold')),
    __param(5, (0, common_1.Query)('investment')),
    __param(6, (0, common_1.Query)('tpPct')),
    __param(7, (0, common_1.Query)('slPct')),
    __param(8, (0, common_1.Query)('lookAhead')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String, String, String, String]),
    __metadata("design:returntype", rxjs_1.Observable)
], PredictorController.prototype, "backtestStream", null);
__decorate([
    (0, common_1.Sse)('backtest/stream-day'),
    __param(0, (0, common_1.Query)('date')),
    __param(1, (0, common_1.Query)('symbols')),
    __param(2, (0, common_1.Query)('fromTime')),
    __param(3, (0, common_1.Query)('toTime')),
    __param(4, (0, common_1.Query)('threshold')),
    __param(5, (0, common_1.Query)('investment')),
    __param(6, (0, common_1.Query)('tpPct')),
    __param(7, (0, common_1.Query)('slPct')),
    __param(8, (0, common_1.Query)('lookAhead')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String, String, String, String]),
    __metadata("design:returntype", rxjs_1.Observable)
], PredictorController.prototype, "backtestStreamDay", null);
__decorate([
    (0, common_1.Post)('backtest'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PredictorController.prototype, "backtest", null);
exports.PredictorController = PredictorController = PredictorController_1 = __decorate([
    (0, common_1.Controller)('predict'),
    __metadata("design:paramtypes", [predictor_service_1.PredictorService])
], PredictorController);
//# sourceMappingURL=predictor.controller.js.map