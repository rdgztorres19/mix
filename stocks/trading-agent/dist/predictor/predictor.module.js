"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "PredictorModule", {
    enumerable: true,
    get: function() {
        return PredictorModule;
    }
});
const _common = require("@nestjs/common");
const _predictorservice = require("./predictor.service");
const _predictorcontroller = require("./predictor.controller");
const _scannermodule = require("../scanner/scanner.module");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
let PredictorModule = class PredictorModule {
};
PredictorModule = _ts_decorate([
    (0, _common.Module)({
        imports: [
            _scannermodule.ScannerModule
        ],
        providers: [
            _predictorservice.PredictorService
        ],
        controllers: [
            _predictorcontroller.PredictorController
        ],
        exports: [
            _predictorservice.PredictorService
        ]
    })
], PredictorModule);

//# sourceMappingURL=predictor.module.js.map