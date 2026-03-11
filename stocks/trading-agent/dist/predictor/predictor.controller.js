"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "PredictorController", {
    enumerable: true,
    get: function() {
        return PredictorController;
    }
});
const _common = require("@nestjs/common");
const _classvalidator = require("class-validator");
const _classtransformer = require("class-transformer");
const _rxjs = require("rxjs");
const _predictorservice = require("./predictor.service");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
function _ts_param(paramIndex, decorator) {
    return function(target, key) {
        decorator(target, key, paramIndex);
    };
}
let CandleDto = class CandleDto {
};
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    _ts_metadata("design:type", Number)
], CandleDto.prototype, "t", void 0);
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    _ts_metadata("design:type", Number)
], CandleDto.prototype, "o", void 0);
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    _ts_metadata("design:type", Number)
], CandleDto.prototype, "h", void 0);
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    _ts_metadata("design:type", Number)
], CandleDto.prototype, "l", void 0);
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    _ts_metadata("design:type", Number)
], CandleDto.prototype, "c", void 0);
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    _ts_metadata("design:type", Number)
], CandleDto.prototype, "v", void 0);
let PredictDto = class PredictDto {
};
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    (0, _classvalidator.IsArray)(),
    (0, _classvalidator.ValidateNested)({
        each: true
    }),
    (0, _classtransformer.Type)(()=>CandleDto),
    _ts_metadata("design:type", Array)
], PredictDto.prototype, "candles", void 0);
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    _ts_metadata("design:type", Number)
], PredictDto.prototype, "target_idx", void 0);
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    _ts_metadata("design:type", Number)
], PredictDto.prototype, "atr", void 0);
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    _ts_metadata("design:type", Number)
], PredictDto.prototype, "high_of_day", void 0);
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    _ts_metadata("design:type", Number)
], PredictDto.prototype, "low_of_day", void 0);
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    _ts_metadata("design:type", Number)
], PredictDto.prototype, "pre_market_high", void 0);
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    _ts_metadata("design:type", Number)
], PredictDto.prototype, "change_pct_at_candle", void 0);
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    (0, _classvalidator.IsString)(),
    _ts_metadata("design:type", String)
], PredictDto.prototype, "ticker", void 0);
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    (0, _classvalidator.IsString)(),
    _ts_metadata("design:type", String)
], PredictDto.prototype, "date", void 0);
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    (0, _classvalidator.IsString)(),
    _ts_metadata("design:type", String)
], PredictDto.prototype, "candle_time_et", void 0);
let PredictorController = class PredictorController {
    /**
   * POST /predict
   * Body: { "open": 5.2, "high": 5.5, "low": 5.1, "close": 5.4, ... }
   * Query: ?threshold=0.3 (opcional, default 0.3 para recall ~91%)
   *
   * Devuelve si se puede operar según el modelo RF entrenado.
   */ async predict(body, thresholdStr) {
        console.time(`Predict`);
        const threshold = thresholdStr ? parseFloat(thresholdStr) : 0.3;
        if (isNaN(threshold) || threshold < 0 || threshold > 1) {
            throw new _common.HttpException('threshold must be between 0 and 1', _common.HttpStatus.BAD_REQUEST);
        }
        this.logger.log(`POST /predict threshold=${threshold}`);
        try {
            const result = await this.predictor.predict(body, threshold);
            return result;
        } catch (err) {
            this.logger.error(`Predict failed: ${err.message}`);
            throw new _common.HttpException(`Predict failed: ${err.message}`, _common.HttpStatus.INTERNAL_SERVER_ERROR);
        } finally{
            console.timeEnd(`Predict`);
        }
    }
    /**
   * GET /predict/evaluate?threshold=0.5
   * Ejecuta evaluate.py --json y devuelve métricas del modelo (recall, precisión, matriz de confusión).
   */ async evaluate(thresholdStr) {
        const threshold = thresholdStr ? parseFloat(thresholdStr) : 0.5;
        if (isNaN(threshold) || threshold < 0 || threshold > 1) {
            throw new _common.HttpException('threshold must be between 0 and 1', _common.HttpStatus.BAD_REQUEST);
        }
        this.logger.log(`GET /predict/evaluate threshold=${threshold}`);
        try {
            const result = await this.predictor.evaluate(threshold);
            return result;
        } catch (err) {
            this.logger.error(`Evaluate failed: ${err.message}`);
            throw new _common.HttpException(`Evaluate failed: ${err.message}`, _common.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    /**
   * GET /predict/backtest-candles?ticker=X&date=YYYY-MM-DD&fromTime=09:35&count=12
   * Returns OHLC candles from entry candle forward for popup chart.
   */ async getBacktestCandles(ticker, date, fromTime, countStr) {
        if (!ticker || !date || !fromTime) {
            throw new _common.HttpException('ticker, date and fromTime are required', _common.HttpStatus.BAD_REQUEST);
        }
        const count = countStr ? parseInt(countStr, 10) : 12;
        if (isNaN(count) || count < 1 || count > 50) {
            throw new _common.HttpException('count must be 1–50', _common.HttpStatus.BAD_REQUEST);
        }
        try {
            return this.predictor.getBacktestCandles(ticker, date, fromTime, count);
        } catch (err) {
            this.logger.error(`getBacktestCandles failed: ${err.message}`);
            throw new _common.HttpException(err.message || 'Failed to fetch candles', _common.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    /**
   * GET /predict/backtest/stream?ticker=X&date=2026-03-05&fromTime=09:30&toTime=16:00&threshold=0.6&investment=200
   * SSE stream: emits row-by-row backtest results in real time.
   */ backtestStream(ticker, date, fromTime, toTime, thresholdStr, investmentStr) {
        if (!ticker || !date) {
            throw new _common.HttpException('ticker and date are required', _common.HttpStatus.BAD_REQUEST);
        }
        const threshold = thresholdStr ? parseFloat(thresholdStr) : 0.6;
        const investment = investmentStr ? parseFloat(investmentStr) : 200;
        this.logger.log(`SSE /predict/backtest/stream ${ticker} ${date} ${fromTime ?? '09:30'}-${toTime ?? '16:00'} thr=${threshold}`);
        return this.predictor.backtestStream(ticker, date, fromTime ?? '09:30', toTime ?? '16:00', threshold, investment);
    }
    /**
   * POST /predict/backtest
   * Body: { ticker, date, fromTime, toTime, threshold?, investment? }
   * Runs candle-by-candle prediction over a historical window (same as debug-predict.js).
   */ async backtest(body) {
        const { ticker, date, fromTime = '09:30', toTime = '16:00' } = body;
        const threshold = body.threshold ?? 0.6;
        const investment = body.investment ?? 200;
        if (!ticker || !date) {
            throw new _common.HttpException('ticker and date are required', _common.HttpStatus.BAD_REQUEST);
        }
        this.logger.log(`POST /predict/backtest ${ticker} ${date} ${fromTime}-${toTime} thr=${threshold}`);
        try {
            const result = await this.predictor.backtest(ticker, date, fromTime, toTime, threshold, investment);
            if (result.error) {
                throw new _common.HttpException(result.error, _common.HttpStatus.NOT_FOUND);
            }
            return result;
        } catch (err) {
            if (err instanceof _common.HttpException) throw err;
            this.logger.error(`Backtest failed: ${err.message}`);
            throw new _common.HttpException(`Backtest failed: ${err.message}`, _common.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    constructor(predictor){
        this.predictor = predictor;
        this.logger = new _common.Logger(PredictorController.name);
    }
};
_ts_decorate([
    (0, _common.Post)(),
    _ts_param(0, (0, _common.Body)()),
    _ts_param(1, (0, _common.Query)('threshold')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof PredictDto === "undefined" ? Object : PredictDto,
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], PredictorController.prototype, "predict", null);
_ts_decorate([
    (0, _common.Get)('evaluate'),
    _ts_param(0, (0, _common.Query)('threshold')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], PredictorController.prototype, "evaluate", null);
_ts_decorate([
    (0, _common.Get)('backtest-candles'),
    _ts_param(0, (0, _common.Query)('ticker')),
    _ts_param(1, (0, _common.Query)('date')),
    _ts_param(2, (0, _common.Query)('fromTime')),
    _ts_param(3, (0, _common.Query)('count')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        String,
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], PredictorController.prototype, "getBacktestCandles", null);
_ts_decorate([
    (0, _common.Sse)('backtest/stream'),
    _ts_param(0, (0, _common.Query)('ticker')),
    _ts_param(1, (0, _common.Query)('date')),
    _ts_param(2, (0, _common.Query)('fromTime')),
    _ts_param(3, (0, _common.Query)('toTime')),
    _ts_param(4, (0, _common.Query)('threshold')),
    _ts_param(5, (0, _common.Query)('investment')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        String,
        String,
        String,
        String
    ]),
    _ts_metadata("design:returntype", typeof _rxjs.Observable === "undefined" ? Object : _rxjs.Observable)
], PredictorController.prototype, "backtestStream", null);
_ts_decorate([
    (0, _common.Post)('backtest'),
    _ts_param(0, (0, _common.Body)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object
    ]),
    _ts_metadata("design:returntype", Promise)
], PredictorController.prototype, "backtest", null);
PredictorController = _ts_decorate([
    (0, _common.Controller)('predict'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _predictorservice.PredictorService === "undefined" ? Object : _predictorservice.PredictorService
    ])
], PredictorController);

//# sourceMappingURL=predictor.controller.js.map