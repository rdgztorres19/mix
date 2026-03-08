"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var PredictorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PredictorService = exports.ML_FEATURE_KEYS = void 0;
const common_1 = require("@nestjs/common");
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
exports.ML_FEATURE_KEYS = [
    'candle_idx', 'open', 'high', 'low', 'close', 'volume', 'atr', 'vwap',
    'high_of_day', 'low_of_day', 'change_pct_at_candle', 'ema9', 'ema20',
    'pre_market_high', 'shares_outstanding', 'market_cap', 'gap_pct',
    'premarket_volume', 'momentum_acumulado', 'change_1m', 'change_5m',
    'change_10m', 'minutes_since_hod',
];
let PredictorService = PredictorService_1 = class PredictorService {
    constructor() {
        this.logger = new common_1.Logger(PredictorService_1.name);
        const stockTraining = path.resolve(process.cwd(), process.env.STOCK_TRAINING_PATH ?? path.join('..', 'stock-training'));
        this.scriptPath = path.join(stockTraining, 'ml', 'random_forest', 'predict.py');
        this.evaluateScriptPath = path.join(stockTraining, 'ml', 'random_forest', 'evaluate.py');
    }
    async evaluate(threshold = 0.5) {
        return new Promise((resolve, reject) => {
            const proc = (0, child_process_1.spawn)('python3', [this.evaluateScriptPath, '--json', '--threshold', String(threshold)], {
                cwd: path.dirname(this.evaluateScriptPath),
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
            proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
            proc.on('error', (err) => {
                this.logger.error(`Evaluate spawn error: ${err.message}`);
                reject(err);
            });
            proc.on('close', (code) => {
                if (code !== 0) {
                    this.logger.warn(`Evaluate script exit ${code}: ${stderr}`);
                    reject(new Error(stderr || `Evaluate failed with code ${code}`));
                    return;
                }
                try {
                    resolve(JSON.parse(stdout));
                }
                catch {
                    reject(new Error(`Invalid evaluate output: ${stdout}`));
                }
            });
        });
    }
    async predict(features, threshold = 0.3) {
        const payload = { ...features, _threshold: threshold };
        const input = JSON.stringify(payload);
        return new Promise((resolve, reject) => {
            const proc = (0, child_process_1.spawn)('python3', [this.scriptPath], {
                cwd: path.dirname(this.scriptPath),
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
            proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
            proc.on('error', (err) => {
                this.logger.error(`Predict spawn error: ${err.message}`);
                reject(err);
            });
            proc.on('close', (code) => {
                if (code !== 0) {
                    this.logger.warn(`Predict script exit ${code}: ${stderr}`);
                }
                try {
                    const result = JSON.parse(stdout);
                    if (result.error) {
                        reject(new Error(result.error));
                    }
                    else {
                        resolve(result);
                    }
                }
                catch {
                    reject(new Error(`Invalid predict output: ${stdout}`));
                }
            });
            proc.stdin.write(input, () => proc.stdin.end());
        });
    }
};
exports.PredictorService = PredictorService;
exports.PredictorService = PredictorService = PredictorService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], PredictorService);
//# sourceMappingURL=predictor.service.js.map