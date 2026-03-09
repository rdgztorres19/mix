#!/usr/bin/env node
/**
 * Compare features calculated by predict.py vs stored in MySQL training_1m.
 * Usage: node scripts/debug-feature-compare.js SYMBOL DATE [TIME]
 * Example: node scripts/debug-feature-compare.js AIFF 2026-03-04 9:34
 */
const mysql = require("mysql2/promise");
const { spawn } = require("child_process");
const path = require("path");

const [symbol, date, time] = process.argv.slice(2);
if (!symbol || !date) {
  console.log("Usage: node scripts/debug-feature-compare.js SYMBOL DATE [TIME]");
  process.exit(1);
}

async function main() {
  const conn = await mysql.createConnection({
    host: "localhost",
    port: 3306,
    user: "root",
    password: "sbrQp10",
    database: "stock_training",
  });

  const [rows] = await conn.query(
    "SELECT * FROM training_1m WHERE symbol = ? AND date = ? ORDER BY candle_idx ASC",
    [symbol, date]
  );
  console.log(`Loaded ${rows.length} candles for ${symbol} ${date}`);

  // Find target candle
  let targetIdx;
  if (time) {
    targetIdx = rows.findIndex((r) => String(r.candle_time_et) === time);
    if (targetIdx === -1) {
      console.log(`Time ${time} not found. Available: ${rows.slice(0, 5).map(r => r.candle_time_et).join(", ")}...`);
      await conn.end();
      return;
    }
  } else {
    // Default: pick candle_idx 20 (enough history for rolling features)
    targetIdx = Math.min(20, rows.length - 1);
  }

  const targetRow = rows[targetIdx];
  console.log(`Target candle: idx=${targetIdx}, time=${targetRow.candle_time_et}, close=${targetRow.close}\n`);

  // Build candles array (all candles up to and including target)
  const candles = rows.slice(0, targetIdx + 1).map((r, i) => ({
    t: i,
    o: Number(r.open || 0),
    h: Number(r.high || 0),
    l: Number(r.low || 0),
    c: Number(r.close || 0),
    v: Number(r.volume || 0),
  }));

  const payload = {
    candles,
    target_idx: candles.length - 1,
    atr: Number(targetRow.atr || 0),
    high_of_day: Number(targetRow.high_of_day || 0),
    low_of_day: Number(targetRow.low_of_day || 0),
    pre_market_high: Number(targetRow.pre_market_high || 0),
    change_pct_at_candle: Number(targetRow.change_pct_at_candle || 0),
    shares_outstanding: Number(targetRow.shares_outstanding || 0),
    market_cap: Number(targetRow.market_cap || 0),
    gap_pct: Number(targetRow.gap_pct || 0),
    premarket_volume: Number(targetRow.premarket_volume || 0),
    _threshold: 0.6,
    _debug: true,
  };

  // Spawn predict.py
  const predictScript = path.resolve(
    __dirname,
    "..",
    "..",
    "stock-training",
    "ml",
    "experiments",
    "predict.py"
  );
  const proc = spawn("python3", [predictScript], {
    cwd: path.dirname(predictScript),
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (c) => (stdout += c));
  proc.stderr.on("data", (c) => (stderr += c));

  proc.on("close", async (code) => {
    if (stderr) console.log("STDERR:", stderr.slice(0, 300));
    if (code !== 0) {
      console.log("predict.py exited with code", code);
      await conn.end();
      return;
    }

    let result;
    try {
      result = JSON.parse(stdout);
    } catch (e) {
      console.log("Failed to parse predict.py output:", stdout.slice(0, 300));
      await conn.end();
      return;
    }

    console.log(`Prediction => prob: ${result.prob}, tradeable: ${result.tradeable}`);
    console.log(`\n${"Feature".padEnd(28)} ${"predict.py".padStart(15)} ${"MySQL".padStart(15)}  Match?`);
    console.log("─".repeat(75));

    const feat = result.debug_features;
    if (!feat) {
      console.log("ERROR: No debug_features in response. Check predict.py _debug support.");
      await conn.end();
      return;
    }

    // Compare all features in debug_features
    const allCols = Object.keys(feat).sort();
    let okCount = 0;
    let diffCount = 0;
    let nullCount = 0;

    for (const col of allCols) {
      const pv = feat[col];
      const mv = targetRow[col] != null ? Number(targetRow[col]) : null;
      const pvStr = pv != null ? pv.toFixed(6) : "null";
      const mvStr = mv != null ? mv.toFixed(6) : "null";

      let matchLabel;
      if (mv === null) {
        matchLabel = "MySQL NULL";
        nullCount++;
      } else if (pv != null && Math.abs(pv - mv) < 0.001) {
        matchLabel = "✓";
        okCount++;
      } else if (pv != null && Math.abs(pv - mv) < 0.05) {
        matchLabel = "~close";
        okCount++;
      } else {
        matchLabel = "✗ DIFF";
        diffCount++;
      }

      // Only print non-OK or first 10 OK
      if (matchLabel !== "✓") {
        console.log(
          `${col.padEnd(28)} ${pvStr.padStart(15)} ${mvStr.padStart(15)}  ${matchLabel}`
        );
      }
    }

    console.log("─".repeat(75));
    console.log(
      `SUMMARY: ${okCount} match, ${diffCount} DIFFERENT, ${nullCount} MySQL NULL (of ${allCols.length} features)`
    );

    if (diffCount > 0) {
      console.log("\n⚠️  DIFFERENT features (predict.py vs MySQL):");
      for (const col of allCols) {
        const pv = feat[col];
        const mv = targetRow[col] != null ? Number(targetRow[col]) : null;
        if (mv !== null && pv != null && Math.abs(pv - mv) >= 0.05) {
          console.log(
            `  ${col}: predict=${pv.toFixed(6)}, mysql=${mv.toFixed(6)}, delta=${(pv - mv).toFixed(6)}`
          );
        }
      }
    }

    await conn.end();
  });

  proc.stdin.write(JSON.stringify(payload), () => proc.stdin.end());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
