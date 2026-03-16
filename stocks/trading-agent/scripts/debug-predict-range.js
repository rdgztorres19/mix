#!/usr/bin/env node
/**
 * Range debug predict:
 * Analiza múltiples días y todos los símbolos disponibles en training_1m.
 *
 * Métricas:
 *   - Global: total wins, total losses, total neutral, total tickets, global win rate
 *   - Por símbolo: wins, losses, neutral, tickets, symbol win rate
 *
 * Uso:
 *   node debug-predict-range.js 2026-03-06 2026-03-08
 *   node debug-predict-range.js 2026-03-06 2026-03-08 09:30 11:00
 *   node debug-predict-range.js 2026-03-06 2026-03-08 09:30 11:00 0.6
 *   node debug-predict-range.js 2026-03-06 2026-03-08 09:30 11:00 0.6 1.5 0.5
 *
 * Args:
 *   0: fromDate   -> YYYY-MM-DD
 *   1: toDate     -> YYYY-MM-DD
 *   2: fromTime   -> HH:mm   (default 09:30)
 *   3: toTime     -> HH:mm   (default 16:00)
 *   4: threshold  -> float   (default 0.6)
 *   5: tpPct      -> float   (default 1.5)
 *   6: slPct      -> float   (default 0.5)
 */

const { spawn } = require('child_process');
const path = require('path');
const mysql = require('mysql2/promise');

const MARKET_OPEN = '09:30';
const MARKET_CLOSE = '16:00';
const LOOKAHEAD_CANDLES = 120;

// ─── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2).filter(a => a !== '--');

const fromDateStr = args[0];
const toDateStr = args[1];
const fromTime = args[2] || MARKET_OPEN;
const toTime = args[3] || MARKET_CLOSE;
const THRESHOLD = parseFloat(args[4] || '0.6');
const TP_PCT = parseFloat(args[5] || '1.5');
const SL_PCT = parseFloat(args[6] || '0.5');

if (!fromDateStr || !toDateStr) {
  console.error(
    'Usage: node debug-predict-range.js <fromDate> <toDate> [fromTime] [toTime] [threshold] [tpPct] [slPct]'
  );
  process.exit(1);
}

const tpDec = TP_PCT / 100;
const slDec = SL_PCT / 100;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function timeToMin(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

function parseDateUTC(dateStr) {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function formatDateUTC(date) {
  return date.toISOString().slice(0, 10);
}

function* dateRange(fromDate, toDate) {
  let cur = parseDateUTC(fromDate);
  const end = parseDateUTC(toDate);
  while (cur <= end) {
    yield formatDateUTC(cur);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

function pct(part, total) {
  if (!total) return 0;
  return (part / total) * 100;
}

/**
 * Simulate: did price hit +TP% before -SL% in next LOOKAHEAD_CANDLES candles?
 * @param {Array<{o:number,h:number,l:number,c:number}>} futureCandles
 * @param {number} refClose
 * @param {number} tpPct
 * @param {number} slPct
 * @returns {'win'|'loss'|'neutral'}
 */
function hitTpBeforeSl(futureCandles, refClose, tpPct, slPct) {
  if (!futureCandles.length || refClose <= 0) return 'neutral';

  const levelUp = refClose * (1 + tpPct);
  const levelDown = refClose * (1 - slPct);
  let prevClose = refClose;

  for (let j = 0; j < Math.min(LOOKAHEAD_CANDLES, futureCandles.length); j++) {
    const { o: openJ, h: highJ, l: lowJ, c: closeJ } = futureCandles[j];

    if (prevClose < openJ) {
      if (prevClose < levelUp && levelUp < openJ) return 'win';
    } else if (prevClose > openJ) {
      if (openJ < levelDown && levelDown < prevClose) return 'loss';
    }

    const touchUp = highJ >= levelUp;
    const touchDown = lowJ <= levelDown;

    if (touchUp && touchDown) {
      if (closeJ >= openJ) return 'loss';
      return 'win';
    }

    if (touchUp) return 'win';
    if (touchDown) return 'loss';

    prevClose = closeJ;
  }

  return 'neutral';
}

// ─── Python predict_batch ────────────────────────────────────────────────────
const stockTraining = path.resolve(__dirname, '..', '..', 'stock-training');
const predictBatchScript = path.join(stockTraining, 'ml', 'experiments', 'predict_batch.py');

function callPredictBatch(batch, threshold) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [predictBatchScript], {
      cwd: path.dirname(predictBatchScript),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', c => { stdout += c; });
    proc.stderr.on('data', c => { stderr += c; });

    proc.on('close', code => {
      if (code !== 0 || !stdout.trim()) {
        reject(new Error(stderr || `exit ${code}, stdout="${stdout}"`));
        return;
      }

      try {
        const out = JSON.parse(stdout);
        if (out.error) reject(new Error(out.error));
        else resolve(out.results || []);
      } catch {
        reject(new Error(`Bad JSON: ${stdout}`));
      }
    });

    proc.stdin.write(JSON.stringify({ batch, _threshold: threshold }), () => proc.stdin.end());
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔮 Debug Predict Range`);
  console.log(`Dates: ${fromDateStr} → ${toDateStr}`);
  console.log(`Time: ${fromTime}–${toTime}`);
  console.log(`Threshold=${THRESHOLD} | TP=${TP_PCT}% | SL=${SL_PCT}% | Lookahead=${LOOKAHEAD_CANDLES} candles`);
  console.log('─'.repeat(140));

  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || 'sbrQp10',
    database: process.env.MYSQL_DATABASE_TRAINING || 'stock_training',
  });

  const fromMin = timeToMin(fromTime);
  const toMin = timeToMin(toTime);

  let globalWins = 0;
  let globalLosses = 0;
  let globalNeutral = 0;
  let globalTickets = 0;

  const allDates = [...dateRange(fromDateStr, toDateStr)];

  for (const dateStr of allDates) {
    const [symbolRows] = await conn.query(
      `
        SELECT DISTINCT t.symbol
        FROM training_1m t
        LEFT JOIN scanned_symbols s
          ON s.symbol = t.symbol
        AND DATE(s.arrived_at) = t.date
        WHERE t.date = ?
          AND (
            s.symbol IS NULL
            OR (
              s.close > 2
              AND s.float_shares BETWEEN 1000000 AND 100000000
              AND s.premarket_dollar_volume <= 10007568.983475
            )
          )
        ORDER BY t.symbol ASC
      `,
      [dateStr],
    );

    const symbols = symbolRows.map(r => String(r.symbol || '').trim()).filter(Boolean);

    console.log(`\n📅 ${dateStr} | symbols=${symbols.length}`);

    for (const symbol of symbols) {
      const [rows] = await conn.query(
        `
        SELECT *
        FROM training_1m
        WHERE symbol = ? AND date = ?
        ORDER BY candle_idx ASC
        `,
        [symbol, dateStr],
      );

      if (!rows.length) continue;

      const allCandles = rows.map((r, i) => ({
        t: i,
        o: Number(r.open || 0),
        h: Number(r.high || 0),
        l: Number(r.low || 0),
        c: Number(r.close || 0),
        v: Number(r.volume || 0),
      }));

      const allCandleTimesEt = rows.map(r => String(r.candle_time_et || '09:30'));
      const allCandleIdxArr = rows.map(r => Number(r.candle_idx || 0));

      const targetRows = [];
      for (let i = 0; i < rows.length; i++) {
        const t = String(rows[i].candle_time_et || '');
        const min = timeToMin(t);
        if (min >= fromMin && min <= toMin) {
          targetRows.push({ idx: i, row: rows[i], time: t });
        }
      }

      if (!targetRows.length) continue;

      const payloads = targetRows.map(({ idx, row }) => {
        const candlesSlice = allCandles.slice(0, idx + 1);
        return {
          candles: candlesSlice,
          target_idx: candlesSlice.length - 1,
          candle_times_et: allCandleTimesEt.slice(0, idx + 1),
          candle_idx_arr: allCandleIdxArr.slice(0, idx + 1),
          atr: Number(row.atr || 0),
          high_of_day: Number(row.high_of_day || 0),
          low_of_day: Number(row.low_of_day || 0),
          pre_market_high: Number(row.pre_market_high || 0),
          change_pct_at_candle: Number(row.change_pct_at_candle || 0),
          shares_outstanding: Number(row.shares_outstanding || 0),
          market_cap: Number(row.market_cap || 0),
          gap_pct: Number(row.gap_pct || 0),
          premarket_volume: Number(row.premarket_volume || 0),
        };
      });

      let results = [];
      try {
        results = await callPredictBatch(payloads, THRESHOLD);
      } catch (e) {
        console.error(`❌ Batch predict failed for ${symbol} ${dateStr}: ${e.message}`);
        continue;
      }

      let symbolWins = 0;
      let symbolLosses = 0;
      let symbolNeutral = 0;
      let symbolTickets = 0;

      for (let i = 0; i < targetRows.length; i++) {
        const { idx, row, time } = targetRows[i];
        const r = results[i] || {};
        const prob = Number(r.prob || 0);
        const tradeable = Boolean(r.tradeable);

        if (!tradeable) continue;

        const futureCandles = rows.slice(idx + 1, idx + 1 + LOOKAHEAD_CANDLES).map((nextRow) => ({
          o: Number(nextRow.open || 0),
          h: Number(nextRow.high || 0),
          l: Number(nextRow.low || 0),
          c: Number(nextRow.close || 0),
        }));

        const result = hitTpBeforeSl(
          futureCandles,
          Number(row.close || 0),
          tpDec,
          slDec,
        );

        symbolTickets++;
        globalTickets++;

        if (result === 'win') {
          symbolWins++;
          globalWins++;
        } else if (result === 'loss') {
          symbolLosses++;
          globalLosses++;
        } else {
          symbolNeutral++;
          globalNeutral++;
        }

        const symbolResolved = symbolWins + symbolLosses;
        const globalResolved = globalWins + globalLosses;

        const symbolWinRate = symbolResolved > 0 ? pct(symbolWins, symbolResolved) : 0;
        const globalWinRate = globalResolved > 0 ? pct(globalWins, globalResolved) : 0;

        process.stdout.write(
          `\r[${dateStr} ${time}] ` +
          `symbol=${symbol} ` +
          `prob=${prob.toFixed(4)} ` +
          `ticket=${symbolTickets} ` +
          `result=${result.padEnd(7)} ` +
          `symbolWins=${symbolWins} ` +
          `symbolLosses=${symbolLosses} ` +
          `symbolNeutral=${symbolNeutral} ` +
          `symbolWinRate=${symbolWinRate.toFixed(2)}% ` +
          `globalWins=${globalWins} ` +
          `globalLosses=${globalLosses} ` +
          `globalNeutral=${globalNeutral} ` +
          `globalWinRate=${globalWinRate.toFixed(2)}%     `
        );
      }

      const symbolResolved = symbolWins + symbolLosses;
      const symbolWinRate = symbolResolved > 0 ? pct(symbolWins, symbolResolved) : 0;

      process.stdout.write('\n');
      console.log(
        `   ${symbol} -> wins=${symbolWins} | losses=${symbolLosses} | neutral=${symbolNeutral} | tickets=${symbolTickets} | winRate=${symbolWinRate.toFixed(2)}%`
      );
    }
  }

  await conn.end();

  const globalResolved = globalWins + globalLosses;
  const globalWinRate = globalResolved > 0 ? pct(globalWins, globalResolved) : 0;

  console.log('\n' + '═'.repeat(90));
  console.log('FINAL SUMMARY');
  console.log('═'.repeat(90));
  console.log(`Global wins     = ${globalWins}`);
  console.log(`Global losses   = ${globalLosses}`);
  console.log(`Global neutral  = ${globalNeutral}`);
  console.log(`Global tickets  = ${globalTickets}`);
  console.log(`Global win rate = ${globalWinRate.toFixed(2)}%`);
  console.log('═'.repeat(90));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});