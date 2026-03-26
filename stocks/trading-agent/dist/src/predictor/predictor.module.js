"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PredictorModule = void 0;
const common_1 = require("@nestjs/common");
const predictor_service_1 = require("./predictor.service");
const predictor_controller_1 = require("./predictor.controller");
const scanner_module_1 = require("../scanner/scanner.module");
let PredictorModule = class PredictorModule {
};
exports.PredictorModule = PredictorModule;
exports.PredictorModule = PredictorModule = __decorate([
    (0, common_1.Module)({
        imports: [scanner_module_1.ScannerModule],
        providers: [predictor_service_1.PredictorService],
        controllers: [predictor_controller_1.PredictorController],
        exports: [predictor_service_1.PredictorService],
    })
], PredictorModule);
//# sourceMappingURL=predictor.module.js.map