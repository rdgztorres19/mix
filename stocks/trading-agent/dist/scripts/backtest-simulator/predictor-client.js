"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "PredictorClient", {
    enumerable: true,
    get: function() {
        return PredictorClient;
    }
});
const _child_process = require("child_process");
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
let PredictorClient = class PredictorClient {
    async predictBatch(payloads, threshold) {
        if (!payloads.length) return [];
        const input = JSON.stringify({
            batch: payloads,
            _threshold: threshold
        });
        return new Promise((resolve, reject)=>{
            const proc = (0, _child_process.spawn)(this.pythonBin, [
                this.batchScriptPath
            ], {
                cwd: _path.default.dirname(this.batchScriptPath),
                stdio: [
                    'pipe',
                    'pipe',
                    'pipe'
                ],
                env: {
                    ...process.env
                }
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (chunk)=>{
                stdout += chunk.toString();
            });
            proc.stderr.on('data', (chunk)=>{
                stderr += chunk.toString();
            });
            proc.on('error', (err)=>reject(err));
            proc.on('close', (code)=>{
                try {
                    const out = JSON.parse(stdout);
                    if (out.error) reject(new Error(out.error));
                    else resolve(out.results ?? []);
                } catch  {
                    reject(new Error(stderr || `predict_batch exit ${code}, stdout=${stdout.slice(0, 500)}`));
                }
            });
            proc.stdin.write(input, ()=>proc.stdin.end());
        });
    }
    constructor(){
        const stockTraining = _path.default.resolve(process.cwd(), process.env.STOCK_TRAINING_PATH ?? _path.default.join('..', 'stock-training'));
        this.batchScriptPath = _path.default.join(stockTraining, 'ml', 'experiments', 'predict_batch.py');
        // Resolve python3 absolute path to avoid PATH issues in child processes
        try {
            this.pythonBin = (0, _child_process.execSync)('which python3', {
                encoding: 'utf-8'
            }).trim();
        } catch  {
            this.pythonBin = 'python3';
        }
        console.log(`  [Predictor] python: ${this.pythonBin}`);
        console.log(`  [Predictor] script: ${this.batchScriptPath}`);
    }
};

//# sourceMappingURL=predictor-client.js.map