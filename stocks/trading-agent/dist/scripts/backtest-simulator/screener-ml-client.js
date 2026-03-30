"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ScreenerMLClient", {
    enumerable: true,
    get: function() {
        return ScreenerMLClient;
    }
});
const _child_process = require("child_process");
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
let ScreenerMLClient = class ScreenerMLClient {
    async scoreBatch(profiles) {
        if (!profiles.length) return [];
        const input = JSON.stringify({
            batch: profiles
        });
        return new Promise((resolve, reject)=>{
            const proc = (0, _child_process.spawn)(this.pythonBin, [
                this.scriptPath
            ], {
                cwd: _path.default.dirname(this.scriptPath),
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
                    else resolve((out.results ?? []).map((r)=>r.score));
                } catch  {
                    reject(new Error(stderr || `predict_screener exit ${code}, stdout=${stdout.slice(0, 500)}`));
                }
            });
            proc.stdin.write(input, ()=>proc.stdin.end());
        });
    }
    constructor(){
        const stockTraining = _path.default.resolve(process.cwd(), process.env.STOCK_TRAINING_PATH ?? _path.default.join('..', 'stock-training'));
        this.scriptPath = _path.default.join(stockTraining, 'ml', 'experiments', 'predict_screener_batch.py');
        try {
            this.pythonBin = (0, _child_process.execSync)('which python3', {
                encoding: 'utf-8'
            }).trim();
        } catch  {
            this.pythonBin = 'python3';
        }
    }
};

//# sourceMappingURL=screener-ml-client.js.map