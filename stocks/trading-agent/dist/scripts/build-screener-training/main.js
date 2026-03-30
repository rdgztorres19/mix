"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _dotenv = /*#__PURE__*/ _interop_require_wildcard(require("dotenv"));
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _fs = /*#__PURE__*/ _interop_require_wildcard(require("fs"));
const _child_process = require("child_process");
const _chalk = /*#__PURE__*/ _interop_require_default(require("chalk"));
const _filecache = require("../data-downloader/file-cache");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
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
_dotenv.config({
    path: _path.default.resolve(__dirname, '../../../.env')
});
// ── Config ───────────────────────────────────────────────────────────────────
const NUM_WORKERS = 10; // number of parallel processes (= CPU cores to use)
const CSV_HEADER = [
    'symbol',
    'date',
    'price',
    'gap_pct',
    'premarket_volume',
    'shares_outstanding',
    'market_cap',
    'atr_pct',
    'volume_at_entry',
    'dist_hod_pct',
    'time_of_first_entry_min',
    'in_gapper',
    'in_gainer_session',
    'in_gainer_intraday',
    'in_high_session',
    'in_high_current',
    'rank_gapper',
    'rank_gainer_session',
    'rank_gainer_intraday',
    'rank_high_session',
    'rank_high_current',
    'num_ranking_types',
    'max_metric_value',
    'combined_rank',
    'total_signals',
    'wins',
    'losses',
    'neutrals',
    'win_rate',
    'avg_pnl',
    'total_pnl',
    'has_winning_trade'
].join(',');
// ── Helpers ──────────────────────────────────────────────────────────────────
function isWeekday(date) {
    const day = date.getUTCDay();
    return day !== 0 && day !== 6;
}
function getBusinessDays(startDate, endDate) {
    const days = [];
    let current = new Date(startDate + 'T12:00:00Z');
    const end = new Date(endDate + 'T12:00:00Z');
    while(current <= end){
        if (isWeekday(current)) days.push(current.toISOString().slice(0, 10));
        current.setUTCDate(current.getUTCDate() + 1);
    }
    return days;
}
function chunkConsecutive(arr, n) {
    const chunks = [];
    const size = Math.ceil(arr.length / n);
    for(let i = 0; i < n; i++){
        chunks.push(arr.slice(i * size, (i + 1) * size));
    }
    return chunks.filter((c)=>c.length > 0);
}
// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2);
    const startDate = args[0];
    const endDate = args[1] || startDate;
    const outputPath = args[2] || _path.default.resolve(__dirname, '../../../../stock-training/data/screener-training.csv');
    if (!startDate) {
        console.error('Usage: ts-node main.ts START_DATE [END_DATE] [OUTPUT_PATH]');
        process.exit(1);
    }
    const businessDays = getBusinessDays(startDate, endDate);
    console.log(_chalk.default.bgBlue.white.bold('\n  Build Screener Training (Multi-Process)  '));
    console.log(_chalk.default.dim(`  Range: ${startDate} → ${endDate} | Days: ${businessDays.length}`));
    console.log(_chalk.default.dim(`  Workers: ${NUM_WORKERS} | Output: ${outputPath}\n`));
    // Filter days with local data
    const pendingDays = [];
    for (const date of businessDays){
        if (await (0, _filecache.hasLocalData)(date)) {
            pendingDays.push(date);
        }
    }
    console.log(_chalk.default.cyan(`  ${pendingDays.length} days with local data (${businessDays.length - pendingDays.length} skipped)\n`));
    if (!pendingDays.length) {
        console.log(_chalk.default.yellow('  No data to process.'));
        return;
    }
    // Split days into N consecutive chunks
    const chunks = chunkConsecutive(pendingDays, NUM_WORKERS);
    // Temp output files per worker
    const tmpDir = _path.default.dirname(outputPath);
    const tmpFiles = chunks.map((_, i)=>_path.default.join(tmpDir, `.screener-worker-${i}.csv`));
    const t0 = Date.now();
    // Launch workers
    const workerScript = _path.default.resolve(__dirname, 'worker.ts');
    const tsNodePath = _path.default.resolve(__dirname, '../../../node_modules/.bin/ts-node');
    const workerPromises = chunks.map((chunk, i)=>{
        if (chunk.length === 0) return Promise.resolve();
        const firstDate = chunk[0];
        const lastDate = chunk[chunk.length - 1];
        console.log(_chalk.default.magenta(`  [W${i}]`) + _chalk.default.dim(` ${chunk.length} days: ${firstDate} → ${lastDate} → ${tmpFiles[i]}`));
        return new Promise((resolve, reject)=>{
            const child = (0, _child_process.fork)(workerScript, [
                String(i),
                firstDate,
                lastDate,
                tmpFiles[i],
                String(pendingDays.length)
            ], {
                execArgv: [
                    '-r',
                    'ts-node/register'
                ],
                stdio: [
                    'inherit',
                    'inherit',
                    'inherit',
                    'ipc'
                ],
                env: {
                    ...process.env
                }
            });
            child.on('message', (msg)=>{
                if (msg.type === 'progress') {
                // Progress from worker — already logged by worker itself
                }
            });
            child.on('exit', (code)=>{
                if (code === 0) resolve();
                else reject(new Error(`Worker ${i} exited with code ${code}`));
            });
            child.on('error', reject);
        });
    });
    // Wait for all workers
    try {
        await Promise.all(workerPromises);
    } catch (err) {
        console.error(_chalk.default.red(`\n  Worker error: ${err.message}`));
    }
    // Concatenate results
    console.log(_chalk.default.cyan('\n  Concatenating worker outputs...'));
    const writeStream = _fs.createWriteStream(outputPath, {
        flags: 'w'
    });
    writeStream.write(CSV_HEADER + '\n');
    let totalRows = 0;
    for(let i = 0; i < tmpFiles.length; i++){
        if (!_fs.existsSync(tmpFiles[i])) continue;
        const content = _fs.readFileSync(tmpFiles[i], 'utf-8');
        const lines = content.split('\n').filter((l)=>l.trim().length > 0);
        totalRows += lines.length;
        for (const line of lines){
            writeStream.write(line + '\n');
        }
        // Clean up temp file
        _fs.unlinkSync(tmpFiles[i]);
    }
    writeStream.end();
    const totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(_chalk.default.bgGreen.black.bold(`\n  ✓ Done! ${totalRows} stock-day rows in ${totalElapsed}s → ${outputPath}  \n`));
}
main().catch((err)=>{
    console.error('Fatal error:', err);
    process.exit(1);
});

//# sourceMappingURL=main.js.map