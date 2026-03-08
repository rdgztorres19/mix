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
const predictor_service_1 = require("./predictor.service");
class PredictDto {
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "candle_idx", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "open", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "high", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "low", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "close", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "volume", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "atr", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "vwap", void 0);
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
], PredictDto.prototype, "change_pct_at_candle", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "ema9", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "ema20", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "pre_market_high", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "shares_outstanding", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "market_cap", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "gap_pct", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "premarket_volume", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "momentum_acumulado", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "change_1m", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "change_5m", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "change_10m", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PredictDto.prototype, "minutes_since_hod", void 0);
let PredictorController = PredictorController_1 = class PredictorController {
    constructor(predictor) {
        this.predictor = predictor;
        this.logger = new common_1.Logger(PredictorController_1.name);
    }
    async predict(body, thresholdStr) {
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
exports.PredictorController = PredictorController = PredictorController_1 = __decorate([
    (0, common_1.Controller)('predict'),
    __metadata("design:paramtypes", [predictor_service_1.PredictorService])
], PredictorController);
//# sourceMappingURL=predictor.controller.js.map