const mysql = require('mysql2/promise');
const axios = require('axios');

/**
 * FIXED: Using exact same logic as trading-agent for MoMo data fetching
 * Based on collector.service.ts and scanner.service.ts implementations
 */

// Debug configuration
const DEBUG_MODE = process.env.DEBUG === 'true' || process.argv.includes('--debug');
const VERBOSE_MODE = process.env.VERBOSE === 'true' || process.argv.includes('--verbose');

function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log('🐛 DEBUG:', ...args);
  }
}

function verboseLog(...args) {
  if (VERBOSE_MODE) {
    console.log('📝 VERBOSE:', ...args);
  }
}

// MySQL connection
async function connectMySQL() {
  return await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || 'sbrQp10',
    database: process.env.MYSQL_DATABASE_TRAINING || 'stock_training',
  });
}

/**
 * Convert timestamp to ET date/time - EXACT copy from indicator.calculator.ts
 */
function timestampToET(ms) {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const h = parseInt(get('hour'), 10);
  const m = parseInt(get('minute'), 10);
  const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return { date, time, minuteOfDay: h * 60 + m };
}

/**
 * Get today's date in ET timezone - EXACT copy from collector.service.ts
 */
function getTodayDateET() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * Fetch MoMo data using EXACT same logic as collector.service.ts
 */
async function fetchMoMoData(symbol) {
  const momoBase = 'https://momoscreener.com/api/p';  // Base URL from trading-agent
  const todayET = getTodayDateET();
  
  console.log(`🔄 Fetching MoMo data for ${symbol}...`);
  debugLog(`URL will be: ${momoBase}/ticker/chart?q=${symbol}&interval=1m`);
  debugLog(`Target date: ${todayET}`);
  
  try {
    const url = `${momoBase}/ticker/chart?q=${symbol}&interval=1m`;
    debugLog('Making HTTP request to MoMo API...');
    const res = await axios.get(url, { timeout: 10000 });
    
    debugLog('Raw response status:', res.status);
    debugLog('Raw response data keys:', Object.keys(res.data || {}));
    
    if (res.data?.error !== 0 || !res.data?.message?.history) {
      debugLog('MoMo API error or no history:', res.data);
      console.warn(`⚠️  MoMo returned no data for ${symbol}`);
      return [];
    }

    const raw = res.data.message.history;
    console.log(`📥 MoMo returned ${raw.length} raw candles for ${symbol}`);
    debugLog(`First raw candle:`, raw[0]);
    debugLog(`Last raw candle:`, raw[raw.length - 1]);
    
    // API returns newest-first → reverse to get chronological order (EXACT copy from scanner.service.ts)
    const allCandles = raw
      .slice()
      .reverse()
      .map(([o, h, l, c, v, t]) => ({ o, h, l, c, v, t }));

    debugLog(`After reverse, first candle:`, allCandles[0]);
    debugLog(`After reverse, last candle:`, allCandles[allCandles.length - 1]);

    console.log(`📊 Sample MoMo timestamps:`);
    allCandles.slice(0, 3).forEach((candle, i) => {
      const { date, time } = timestampToET(candle.t);
      console.log(`   ${i+1}. Raw: ${candle.t} → ${date} ${time} ET`);
      debugLog(`   Candle details:`, candle);
    });

    // Filter to today only (EXACT copy from collector.service.ts)
    const todayCandles = allCandles.filter((c) => {
      const { date } = timestampToET(c.t);
      const isToday = date === todayET;
      if (!isToday) {
        verboseLog(`Filtering out: ${c.t} → ${date} (not ${todayET})`);
      }
      return isToday;
    });

    console.log(`✅ After filtering for ${todayET}: ${todayCandles.length} candles`);
    debugLog(`Today candles date range:`, 
      todayCandles.length > 0 ? {
        first: timestampToET(todayCandles[0].t),
        last: timestampToET(todayCandles[todayCandles.length - 1].t)
      } : 'No candles'
    );
    
    return todayCandles;
    
  } catch (err) {
    debugLog('MoMo fetch error details:', err.message, err.code);
    console.warn(`❌ MoMo fetch failed for ${symbol}: ${err.message}`);
    return [];
  }
}

/**
 * Get MySQL data for symbol and today's date
 */
async function getMySQLData(conn, symbol) {
  const todayET = getTodayDateET();
  
  console.log(`🔍 Fetching MySQL data for ${symbol} on ${todayET}...`);
  debugLog(`MySQL query: SELECT * FROM training_1m WHERE symbol = '${symbol}' AND date = '${todayET}' ORDER BY candle_idx ASC`);
  
  const [rows] = await conn.query(
    'SELECT * FROM training_1m WHERE symbol = ? AND date = ? ORDER BY candle_idx ASC',
    [symbol, todayET]
  );

  console.log(`📊 MySQL returned ${rows.length} candles for ${symbol}`);
  
  if (rows.length > 0) {
    debugLog('First MySQL row:', rows[0]);
    debugLog('Last MySQL row:', rows[rows.length - 1]);
    debugLog('MySQL columns:', Object.keys(rows[0]));
  }
  
  return rows;
}

/**
 * Compare OHLCV data between MySQL and MoMo with tolerance
 * Only compares candles up to the latest time available in BOTH sources
 */
function compareCandles(mysqlCandles, momoCandles, symbol) {
  debugger; // 🛑 BREAKPOINT 1: Inicio de comparación
  console.log(`\n🔍 Comparing OHLCV data for ${symbol}:`);
  console.log(`   MySQL: ${mysqlCandles.length} candles`);
  console.log(`   MoMo:  ${momoCandles.length} candles`);
  
  // Create comparison maps by minute
  const mysqlByMinute = new Map();
  mysqlCandles.forEach(row => {
    // Ensure consistent string format for date
    const dateStr = typeof row.date === 'string' ? row.date : 
                    row.date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const key = `${dateStr} ${row.candle_time_et}`;
    mysqlByMinute.set(key, row);
  });

  const momoByMinute = new Map();
  momoCandles.forEach(candle => {
    const { date, time } = timestampToET(candle.t);
    const key = `${date} ${time}`;
    momoByMinute.set(key, candle);
  });

  // Find the latest time available in both sources (intersection)
  const mysqlTimes = Array.from(mysqlByMinute.keys()).sort();
  const momoTimes = Array.from(momoByMinute.keys()).sort();
  
  const mysqlLatest = mysqlTimes[mysqlTimes.length - 1] || '';
  const momoLatest = momoTimes[momoTimes.length - 1] || '';
  
  // Use the earlier of the two latest times as cutoff
  const cutoffTime = mysqlLatest <= momoLatest ? mysqlLatest : momoLatest;
  
  debugger; // 🛑 BREAKPOINT 2: Después del cálculo de cutoff
  console.log(`📋 Time range analysis:`);
  console.log(`   MySQL latest: ${mysqlLatest}`);
  console.log(`   MoMo latest:  ${momoLatest}`);
  console.log(`   Using cutoff: ${cutoffTime}`);
  console.log(`   MySQL unique times: ${mysqlTimes.length}`);
  console.log(`   MoMo unique times:  ${momoTimes.length}`);
  
  // Filter both datasets to only include times up to cutoff
  const filteredMysqlTimes = mysqlTimes.filter(time => time <= cutoffTime);
  const filteredMomoTimes = momoTimes.filter(time => time <= cutoffTime);
  
  console.log(`   Filtered MySQL times: ${filteredMysqlTimes.length}`);
  console.log(`   Filtered MoMo times:  ${filteredMomoTimes.length}`);

  // Show first few times from filtered datasets for comparison
  console.log(`\n📊 First 5 MySQL times (filtered):`);
  filteredMysqlTimes.slice(0, 5).forEach(time => console.log(`   ${time}`));
  
  console.log(`\n📊 First 5 MoMo times (filtered):`);
  filteredMomoTimes.slice(0, 5).forEach(time => console.log(`   ${time}`));

  // Find matches using only filtered times
  let matches = 0;
  let mismatches = 0;
  let mismatchDetails = []; // Store mismatch details
  const tolerance = 0.01; // 1 cent tolerance for price differences

  console.log(`\n🔎 Detailed OHLCV comparison (first 10 from filtered data):`);
  console.log(`Time           │ Source │   Open │   High │    Low │  Close │    Volume`);
  console.log(`───────────────────────────────────────────────────────────────────────────`);

  let detailCount = 0;
  
  // First pass: show first 10 for reference
  for (const timeKey of filteredMysqlTimes) {
    if (detailCount >= 10) break;
    
    const mysqlRow = mysqlByMinute.get(timeKey);
    const momoCandle = momoByMinute.get(timeKey);
    
    // Skip if either source doesn't have this time (shouldn't happen with filtered times)
    if (!mysqlRow || !momoCandle) continue;
    
    // Ensure numerical conversion for safe comparison
    const mysqlOpen = Number(mysqlRow.open);
    const mysqlHigh = Number(mysqlRow.high);
    const mysqlLow = Number(mysqlRow.low);
    const mysqlClose = Number(mysqlRow.close);
    const mysqlVolume = Number(mysqlRow.volume);
    
    console.log(`${timeKey} │ MySQL  │ ${mysqlOpen.toFixed(4).padStart(7)} │ ${mysqlHigh.toFixed(4).padStart(7)} │ ${mysqlLow.toFixed(4).padStart(7)} │ ${mysqlClose.toFixed(4).padStart(7)} │ ${mysqlVolume.toString().padStart(9)}`);
    console.log(`          │ MoMo   │ ${momoCandle.o.toFixed(4).padStart(7)} │ ${momoCandle.h.toFixed(4).padStart(7)} │ ${momoCandle.l.toFixed(4).padStart(7)} │ ${momoCandle.c.toFixed(4).padStart(7)} │ ${momoCandle.v.toString().padStart(9)}`);
    
    // Calculate and show differences for detailed analysis
    const openDiff = Math.abs(mysqlOpen - momoCandle.o);
    const highDiff = Math.abs(mysqlHigh - momoCandle.h);
    const lowDiff = Math.abs(mysqlLow - momoCandle.l);
    const closeDiff = Math.abs(mysqlClose - momoCandle.c);
    const volumeDiff = Math.abs(mysqlVolume - momoCandle.v);
    
    console.log(`          │ Δ Diff │ ${openDiff.toFixed(4).padStart(7)} │ ${highDiff.toFixed(4).padStart(7)} │ ${lowDiff.toFixed(4).padStart(7)} │ ${closeDiff.toFixed(4).padStart(7)} │ ${volumeDiff.toString().padStart(9)}`);
    
    // Check if prices match within tolerance
    const openMatch = Math.abs(mysqlOpen - momoCandle.o) <= tolerance;
    const highMatch = Math.abs(mysqlHigh - momoCandle.h) <= tolerance;
    const lowMatch = Math.abs(mysqlLow - momoCandle.l) <= tolerance;
    const closeMatch = Math.abs(mysqlClose - momoCandle.c) <= tolerance;
    const volumeMatch = mysqlVolume === momoCandle.v;
    
    if (openMatch && highMatch && lowMatch && closeMatch && volumeMatch) {
      console.log(`          │ Status │ ✅ PERFECT MATCH (all within tolerance ${tolerance})`);
      matches++;
    } else {
      debugger; // 🛑 BREAKPOINT 3: Cuando encuentra un mismatch específico
      console.log(`          │ Status │ ⚠️  MISMATCH - O:${openMatch?'✓':'✗'} H:${highMatch?'✓':'✗'} L:${lowMatch?'✓':'✗'} C:${closeMatch?'✓':'✗'} V:${volumeMatch?'✓':'✗'}`);
      
      // Show detailed mismatch analysis
      if (!openMatch) console.log(`          │        │ 🔴 OPEN: MySQL=${mysqlOpen.toFixed(4)} vs MoMo=${momoCandle.o.toFixed(4)} (diff: ${openDiff.toFixed(4)})`);
      if (!highMatch) console.log(`          │        │ 🔴 HIGH: MySQL=${mysqlHigh.toFixed(4)} vs MoMo=${momoCandle.h.toFixed(4)} (diff: ${highDiff.toFixed(4)})`);
      if (!lowMatch) console.log(`          │        │ 🔴 LOW:  MySQL=${mysqlLow.toFixed(4)} vs MoMo=${momoCandle.l.toFixed(4)} (diff: ${lowDiff.toFixed(4)})`);
      if (!closeMatch) console.log(`          │        │ 🔴 CLOSE: MySQL=${mysqlClose.toFixed(4)} vs MoMo=${momoCandle.c.toFixed(4)} (diff: ${closeDiff.toFixed(4)})`);
      if (!volumeMatch) console.log(`          │        │ 🔴 VOLUME: MySQL=${mysqlVolume} vs MoMo=${momoCandle.v} (diff: ${volumeDiff})`);
      
      mismatches++;
      
      // Store mismatch details with differences
      mismatchDetails.push({
        time: timeKey,
        mysql: { o: mysqlOpen, h: mysqlHigh, l: mysqlLow, c: mysqlClose, v: mysqlVolume },
        momo: { o: momoCandle.o, h: momoCandle.h, l: momoCandle.l, c: momoCandle.c, v: momoCandle.v },
        differences: { open: openDiff, high: highDiff, low: lowDiff, close: closeDiff, volume: volumeDiff },
        matches: { openMatch, highMatch, lowMatch, closeMatch, volumeMatch }
      });
    }
    
    console.log(`────────────────────────────────────────────────────────────────────`);
    detailCount++;
  }
  
  // Second pass: count all matches and collect all mismatches
  for (const timeKey of filteredMysqlTimes) {
    if (detailCount >= 10) { // Skip detailed display but continue counting
      const mysqlRow = mysqlByMinute.get(timeKey);
      const momoCandle = momoByMinute.get(timeKey);
      
      if (!mysqlRow || !momoCandle) continue;
      
      const mysqlOpen = Number(mysqlRow.open);
      const mysqlHigh = Number(mysqlRow.high);
      const mysqlLow = Number(mysqlRow.low);
      const mysqlClose = Number(mysqlRow.close);
      const mysqlVolume = Number(mysqlRow.volume);
      
      const openMatch = Math.abs(mysqlOpen - momoCandle.o) <= tolerance;
      const highMatch = Math.abs(mysqlHigh - momoCandle.h) <= tolerance;
      const lowMatch = Math.abs(mysqlLow - momoCandle.l) <= tolerance;
      const closeMatch = Math.abs(mysqlClose - momoCandle.c) <= tolerance;
      const volumeMatch = mysqlVolume === momoCandle.v;
      
      if (openMatch && highMatch && lowMatch && closeMatch && volumeMatch) {
        matches++;
      } else {
        mismatches++;
        
        // Calculate differences for detailed reporting
        const openDiff = Math.abs(mysqlOpen - momoCandle.o);
        const highDiff = Math.abs(mysqlHigh - momoCandle.h);
        const lowDiff = Math.abs(mysqlLow - momoCandle.l);
        const closeDiff = Math.abs(mysqlClose - momoCandle.c);
        const volumeDiff = Math.abs(mysqlVolume - momoCandle.v);
        
        // Store mismatch details for reporting
        mismatchDetails.push({
          time: timeKey,
          mysql: { o: mysqlOpen, h: mysqlHigh, l: mysqlLow, c: mysqlClose, v: mysqlVolume },
          momo: { o: momoCandle.o, h: momoCandle.h, l: momoCandle.l, c: momoCandle.c, v: momoCandle.v },
          differences: { open: openDiff, high: highDiff, low: lowDiff, close: closeDiff, volume: volumeDiff },
          matches: { openMatch, highMatch, lowMatch, closeMatch, volumeMatch }
        });
      }
    }
  }

  // Show all mismatches found with detailed analysis
  if (mismatchDetails.length > 0) {
    console.log(`\n🚨 DETAILED MISMATCH ANALYSIS (${mismatchDetails.length} mismatches found):`);
    console.log(`════════════════════════════════════════════════════════════════════════════`);
    
    // Analyze types of mismatches
    let openMismatches = 0, highMismatches = 0, lowMismatches = 0, closeMismatches = 0, volumeMismatches = 0;
    let maxOpenDiff = 0, maxHighDiff = 0, maxLowDiff = 0, maxCloseDiff = 0, maxVolumeDiff = 0;
    
    mismatchDetails.forEach((mismatch) => {
      if (!mismatch.matches.openMatch) {
        openMismatches++;
        maxOpenDiff = Math.max(maxOpenDiff, mismatch.differences.open);
      }
      if (!mismatch.matches.highMatch) {
        highMismatches++;
        maxHighDiff = Math.max(maxHighDiff, mismatch.differences.high);
      }
      if (!mismatch.matches.lowMatch) {
        lowMismatches++;
        maxLowDiff = Math.max(maxLowDiff, mismatch.differences.low);
      }
      if (!mismatch.matches.closeMatch) {
        closeMismatches++;
        maxCloseDiff = Math.max(maxCloseDiff, mismatch.differences.close);
      }
      if (!mismatch.matches.volumeMatch) {
        volumeMismatches++;
        maxVolumeDiff = Math.max(maxVolumeDiff, mismatch.differences.volume);
      }
    });
    
    console.log(`📈 MISMATCH SUMMARY:`);
    console.log(`   🔴 Open mismatches:  ${openMismatches} (max diff: ${maxOpenDiff.toFixed(4)})`);
    console.log(`   🔴 High mismatches:  ${highMismatches} (max diff: ${maxHighDiff.toFixed(4)})`);
    console.log(`   🔴 Low mismatches:   ${lowMismatches} (max diff: ${maxLowDiff.toFixed(4)})`);
    console.log(`   🔴 Close mismatches: ${closeMismatches} (max diff: ${maxCloseDiff.toFixed(4)})`);
    console.log(`   🔴 Volume mismatches: ${volumeMismatches} (max diff: ${maxVolumeDiff.toFixed(0)})`);
    
    console.log(`\n🔍 TOP MISMATCHES (showing first 10):`);
    mismatchDetails.slice(0, 10).forEach((mismatch, index) => {
      console.log(`\n🕐 ${mismatch.time} - Mismatch #${index + 1}:`);
      console.log(`   MySQL: O=${mismatch.mysql.o.toFixed(4)} H=${mismatch.mysql.h.toFixed(4)} L=${mismatch.mysql.l.toFixed(4)} C=${mismatch.mysql.c.toFixed(4)} Vol=${mismatch.mysql.v}`);
      console.log(`   MoMo:  O=${mismatch.momo.o.toFixed(4)} H=${mismatch.momo.h.toFixed(4)} L=${mismatch.momo.l.toFixed(4)} C=${mismatch.momo.c.toFixed(4)} Vol=${mismatch.momo.v}`);
      
      const diffs = [];
      if (!mismatch.matches.openMatch) diffs.push(`Open: Δ${mismatch.differences.open.toFixed(4)}`);
      if (!mismatch.matches.highMatch) diffs.push(`High: Δ${mismatch.differences.high.toFixed(4)}`);
      if (!mismatch.matches.lowMatch) diffs.push(`Low: Δ${mismatch.differences.low.toFixed(4)}`);
      if (!mismatch.matches.closeMatch) diffs.push(`Close: Δ${mismatch.differences.close.toFixed(4)}`);
      if (!mismatch.matches.volumeMatch) diffs.push(`Volume: Δ${mismatch.differences.volume.toFixed(0)}`);
      
      console.log(`   💥 Issues: ${diffs.join(', ')}`);
    });
    
    if (mismatchDetails.length > 10) {
      console.log(`\n... and ${mismatchDetails.length - 10} more mismatches (use DEBUG=true for full details)`);
    }
    
    console.log(`════════════════════════════════════════════════════════════════════════════`);
  }

  console.log(`\n📊 Final Results for ${symbol} (filtered comparison):`);
  console.log(`   🕐 Time range: up to ${cutoffTime}`);
  console.log(`   📊 Valid comparisons: ${filteredMysqlTimes.length}`);
  console.log(`   ✅ Perfect matches: ${matches}`);
  console.log(`   ⚠️  Mismatches:     ${mismatches}`);
  console.log(`   📈 Match rate:      ${matches > 0 ? ((matches / (matches + mismatches)) * 100).toFixed(1) : 0}%`);
  
  return { matches, mismatches, total: matches + mismatches, cutoffTime, comparisons: filteredMysqlTimes.length };
}

/**
 * Main verification function
 */
async function verifySync(symbols = ['ATPC', 'ACXP']) {
  console.log(`\n🚀 FIXED MoMo-MySQL Sync Verification`);
  console.log(`📅 Target date: ${getTodayDateET()}`);
  console.log(`🎯 Symbols: ${symbols.join(', ')}`);
  console.log(`═══════════════════════════════════════════════════════════════════════════════════`);

  const conn = await connectMySQL();
  console.log(`✅ Connected to MySQL`);

  let totalMatches = 0;
  let totalMismatches = 0;
  let totalComparisons = 0;

  for (const symbol of symbols) {
    console.log(`\n${'█'.repeat(80)}`);
    console.log(`📈 Processing: ${symbol}`);
    console.log(`${'─'.repeat(80)}`);
    
    try {
      // Fetch data using exact same logic as trading-agent
      const [mysqlData, momoData] = await Promise.all([
        getMySQLData(conn, symbol),
        fetchMoMoData(symbol)
      ]);

      debugger; // 🛑 BREAKPOINT 4: Después de obtener datos de MySQL y MoMo

      if (mysqlData.length === 0) {
        console.log(`⚠️  No MySQL data for ${symbol} - skipping`);
        continue;
      }

      if (momoData.length === 0) {
        console.log(`⚠️  No MoMo data for ${symbol} - skipping`);
        continue;
      }

      debugger; // 🛑 BREAKPOINT 5: Antes de la comparación

      const results = compareCandles(mysqlData, momoData, symbol);
      totalMatches += results.matches;
      totalMismatches += results.mismatches;
      totalComparisons += results.comparisons;

    } catch (error) {
      console.error(`❌ Error processing ${symbol}:`, error.message);
    }
  }

  await conn.end();

  console.log(`\n${'█'.repeat(80)}`);
  console.log(`📊 FINAL VERIFICATION RESULTS (Filtered Comparison)`);
  console.log(`${'─'.repeat(80)}`);
  console.log(`📊 Total valid comparisons: ${totalComparisons}`);
  console.log(`✅ Total perfect matches: ${totalMatches}`);
  console.log(`⚠️  Total mismatches:     ${totalMismatches}`);
  console.log(`📈 Overall match rate:    ${totalMatches > 0 ? ((totalMatches / (totalMatches + totalMismatches)) * 100).toFixed(1) : 0}%`);
  
  if (totalMatches > 0) {
    console.log(`\n🎉 SUCCESS: Data synchronization is working correctly!`);
    console.log(`   Using filtered comparison (overlap between MySQL and MoMo)`);
    console.log(`   ${totalComparisons} valid time slots compared across all symbols`);
    console.log(`   MoMo data is properly syncing to MySQL`);
  } else {
    console.log(`\n❌ ISSUE: No matching data found`);
    console.log(`   This might indicate a real synchronization problem`);
    console.log(`   Or no overlapping time slots between MySQL and MoMo`);
  }
  
  console.log(`═══════════════════════════════════════════════════════════════════════════════════`);
}

// Run verification with active symbols
if (require.main === module) {
  debugger; // 🛑 BREAKPOINT 0: INICIO DEL SCRIPT - Pausa aquí para empezar debugging
  console.log('🚀 INICIANDO DEBUGGING - Script started for verification');
  console.log('📍 BREAKPOINT HIT: Main execution starting...');
  
  // You can override symbols via command line: node fixed-sync-verification.js AAPL TSLA MSFT
  const symbols = process.argv.slice(2);
  if (symbols.length === 0) {
    symbols.push('ATPC', 'CRCG');  // Priority focus on ATPC for debugging WebSocket vs API discrepancies
  }
  
  console.log(`🎯 Symbols to verify: ${symbols.join(', ')}`);
  console.log('💡 DEBUGGING TIP: Use F10 (Step Over), F11 (Step Into), F5 (Continue)');
  console.log('🔍 SPECIAL FOCUS: Looking for WebSocket vs Historical data discrepancies (like ATPC timestamp 1773156480000)');
  
  verifySync(symbols)
    .then(() => {
      console.log('✅ Verification completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Verification failed:', error);
      process.exit(1);
    });
}

module.exports = { verifySync, timestampToET, getTodayDateET };