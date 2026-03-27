"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "CollectorFeaturesTodayDto", {
    enumerable: true,
    get: function() {
        return CollectorFeaturesTodayDto;
    }
});
const _classvalidator = require("class-validator");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
let CollectorFeaturesTodayDto = class CollectorFeaturesTodayDto {
};
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    (0, _classvalidator.IsArray)(),
    (0, _classvalidator.IsString)({
        each: true
    }),
    _ts_metadata("design:type", Array)
], CollectorFeaturesTodayDto.prototype, "symbols", void 0);
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    (0, _classvalidator.IsString)(),
    _ts_metadata("design:type", String)
], CollectorFeaturesTodayDto.prototype, "symbolsCsv", void 0);
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    (0, _classvalidator.IsString)(),
    (0, _classvalidator.Matches)(/^\d{4}-\d{2}-\d{2}$/, {
        message: 'date must be YYYY-MM-DD'
    }),
    _ts_metadata("design:type", String)
], CollectorFeaturesTodayDto.prototype, "date", void 0);
_ts_decorate([
    (0, _classvalidator.IsOptional)(),
    (0, _classvalidator.IsBoolean)(),
    _ts_metadata("design:type", Boolean)
], CollectorFeaturesTodayDto.prototype, "includeCandles", void 0);

//# sourceMappingURL=collector-features-today.dto.js.map