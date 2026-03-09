"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "PredictorService", {
    enumerable: true,
    get: function() {
        return PredictorService;
    }
});
const _common = require("@nestjs/common");
const _child_process = require("child_process");
const _path = /*#__PURE__*/ _interop_require_wildcard(require("path"));
const _mysqltrainingrepository = require("../scanner/mysql/mysql-training.repository");
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
let PredictorService = class PredictorService {
    async evaluate(threshold = 0.5) {
        return new Promise((resolve, reject)=>{
            const proc = (0, _child_process.spawn)('python3', [
                this.evaluateScriptPath,
                '--json',
                '--threshold',
                String(threshold)
            ], {
                cwd: _path.dirname(this.evaluateScriptPath),
                stdio: [
                    'pipe',
                    'pipe',
                    'pipe'
                ]
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (chunk)=>{
                stdout += chunk.toString();
            });
            proc.stderr.on('data', (chunk)=>{
                stderr += chunk.toString();
            });
            proc.on('error', (err)=>{
                this.logger.error(`Evaluate spawn error: ${err.message}`);
                reject(err);
            });
            proc.on('close', (code)=>{
                if (code !== 0) {
                    this.logger.warn(`Evaluate script exit ${code}: ${stderr}`);
                    reject(new Error(stderr || `Evaluate failed with code ${code}`));
                    return;
                }
                try {
                    resolve(JSON.parse(stdout));
                } catch  {
                    reject(new Error(`Invalid evaluate output: ${stdout}`));
                }
            });
        });
    }
    async predict(features, threshold = 0.3) {
        let payload;
        if (features.ticker && features.date && features.candle_time_et) {
            // Historical mode: fetch candle data from MySQL, convert to candles array for Python
            const rows = await this.mysqlRepo.getTickerRowsForDate(features.ticker, features.date, '1m');
            if (!rows.length) {
                return {
                    tradeable: false,
                    prob: 0,
                    threshold,
                    error: `No data for ${features.ticker} on ${features.date}`
                };
            }
            // Find target row index by candle_time_et
            let targetIdx = rows.length - 1;
            for(let i = 0; i < rows.length; i++){
                if (String(rows[i].candle_time_et) === features.candle_time_et) {
                    targetIdx = i;
                }
            }
            // Convert MySQL rows to candle format for Python
            const candles = rows.map((r, i)=>({
                    t: i,
                    o: Number(r.open ?? 0),
                    h: Number(r.high ?? 0),
                    l: Number(r.low ?? 0),
                    c: Number(r.close ?? 0),
                    v: Number(r.volume ?? 0)
                }));
            // Pass candle_time_et and candle_idx arrays from MySQL so Python can
            // derive correct time-based and index-based features
            const candleTimesEt = rows.map((r)=>String(r.candle_time_et ?? '09:30'));
            const candleIdxArr = rows.map((r)=>Number(r.candle_idx ?? 0));
            // Pass along key metadata from the MySQL rows
            const targetRow = rows[targetIdx];
            payload = {
                candles,
                target_idx: targetIdx,
                candle_times_et: candleTimesEt,
                candle_idx_arr: candleIdxArr,
                atr: Number(targetRow.atr ?? 0),
                high_of_day: Number(targetRow.high_of_day ?? 0),
                low_of_day: Number(targetRow.low_of_day ?? 0),
                pre_market_high: Number(targetRow.pre_market_high ?? 0),
                change_pct_at_candle: Number(targetRow.change_pct_at_candle ?? 0),
                // Pass enriched columns that MySQL already has (so Python doesn't recompute)
                shares_outstanding: Number(targetRow.shares_outstanding ?? 0),
                market_cap: Number(targetRow.market_cap ?? 0),
                gap_pct: Number(targetRow.gap_pct ?? 0),
                premarket_volume: Number(targetRow.premarket_volume ?? 0),
                _threshold: threshold
            };
            this.logger.log(`Historical predict: ${features.ticker} ${features.date} ${features.candle_time_et} (${rows.length} candles, target=${targetIdx})`);
        } else {
            // Live mode: pass through candles array as-is
            payload = {
                ...features,
                _threshold: threshold
            };
        }
        const input = JSON.stringify(payload);
        return new Promise((resolve, reject)=>{
            const proc = (0, _child_process.spawn)('python3', [
                this.scriptPath
            ], {
                cwd: _path.dirname(this.scriptPath),
                stdio: [
                    'pipe',
                    'pipe',
                    'pipe'
                ]
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (chunk)=>{
                stdout += chunk.toString();
            });
            proc.stderr.on('data', (chunk)=>{
                stderr += chunk.toString();
            });
            proc.on('error', (err)=>{
                this.logger.error(`Predict spawn error: ${err.message}`);
                reject(err);
            });
            proc.on('close', (code)=>{
                if (code !== 0) {
                    this.logger.warn(`Predict script exit ${code}: ${stderr}`);
                }
                try {
                    const result = JSON.parse(stdout);
                    if (result.error) {
                        reject(new Error(result.error));
                    } else {
                        resolve(result);
                    }
                } catch  {
                    reject(new Error(`Invalid predict output: ${stdout}`));
                }
            });
            proc.stdin.write(input, ()=>proc.stdin.end());
        });
    }
    constructor(mysqlRepo){
        this.mysqlRepo = mysqlRepo;
        this.logger = new _common.Logger(PredictorService.name);
        const stockTraining = _path.resolve(process.cwd(), process.env.STOCK_TRAINING_PATH ?? _path.join('..', 'stock-training'));
        this.scriptPath = _path.join(stockTraining, 'ml', 'experiments', 'predict.py');
        this.evaluateScriptPath = _path.join(stockTraining, 'ml', 'random_forest', 'evaluate.py');
    }
};
PredictorService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _mysqltrainingrepository.MysqlTrainingRepository === "undefined" ? Object : _mysqltrainingrepository.MysqlTrainingRepository
    ])
], PredictorService);

//# sourceMappingURL=predictor.service.js.map