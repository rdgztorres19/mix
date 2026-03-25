#!/usr/bin/env node

/**
 * Build training rows from Alpaca using the SAME indicator logic as the original file,
 * then compare candle-by-candle vs MySQL stock_training.training_1m and emit a JSON diff.
 *
 * Usage:
 *   node debug-diff-alpaca-vs-mysql.js ANNA 2026-03-24
 *   node debug-diff-alpaca-vs-mysql.js ANNA 2026-03-24 04:00 09:30
 *   node debug-diff-alpaca-vs-mysql.js ANNA 2026-03-24 04:00 09:30 ./diff_ANNA_2026-03-24.json
 *
 * Args:
 *   0: ticker
 *   1: date (YYYY-MM-DD)
 *   2: fromTime (HH:mm) optional
 *   3: toTime   (HH:mm) optional
 *   4: output.json optional
 *
 * Env:
 *   MYSQL_HOST=127.0.0.1
 *   MYSQL_PORT=3306
 *   MYSQL_USER=root
 *   MYSQL_PASSWORD=secret
 *   MYSQL_DATABASE=stock_training
 *
 * Install:
 *   npm i axios mysql2 dotenv
 */

const fs = require('fs');
const axios = require('axios');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const NY_TZ = 'America/New_York';
const REGULAR_OPEN_MIN = 9 * 60 + 30;

// Hardcoded exactly as requested
const APCA_API_KEY_ID = 'AKAS3FTVF54TKVHQSOO44I5XJH';
const APCA_API_SECRET_KEY = 'Br5quiybxDxEhw2WsX1EhHMq83f4TZX4RAhoxzkdQG2d';

// ──────────────────────────────────────────────────────────────────────────────
// Args
// ──────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2).filter(a => a !== '--');

const ticker = (args[0] || '').toUpperCase();
const dateStr = args[1] || nyToday();
const fromTime = args[2] || null;
const toTime = args[3] || null;
const outPath = args[4]
    ? path.resolve(args[4])
    : path.resolve(
        process.cwd(), 'diffs',
        `diff_${ticker}_${dateStr}${fromTime || toTime ? `_${fromTime || 'start'}_${toTime || 'end'}` : ''}.json`
    );

// ──────────────────────────────────────────────────────────────────────────────
// Time helpers
// ──────────────────────────────────────────────────────────────────────────────
function nyToday() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: NY_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

function timeToMin(t) {
    const [h = '0', m = '0'] = String(t).split(':');
    return Number(h) * 60 + Number(m);
}

function isWithinTimeRange(candleTimeEt, fromTime, toTime) {
    const t = timeToMin(candleTimeEt);
    if (fromTime && t < timeToMin(fromTime)) return false;
    if (toTime && t > timeToMin(toTime)) return false;
    return true;
}

function parseGmtOffsetToMinutes(offsetText) {
    const match = String(offsetText).match(/([A-Z]+)([+-])(\d{1,2})(?::?(\d{2}))?/i);
    if (!match) return -300;
    const sign = match[2] === '-' ? -1 : 1;
    const hours = Number(match[3] || 0);
    const mins = Number(match[4] || 0);
    return sign * (hours * 60 + mins);
}

function getNyOffsetMinutes(date, time = '12:00:00') {
    const approxUtc = new Date(`${date}T${time}Z`);
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: NY_TZ,
        timeZoneName: 'shortOffset',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(approxUtc);

    const tzName = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-5';
    return parseGmtOffsetToMinutes(tzName);
}

function nyLocalToUtcIso(date, time = '00:00:00') {
    const [year, month, day] = date.split('-').map(Number);
    const [hh, mm, ss = '00'] = time.split(':');
    const offsetMinutes = getNyOffsetMinutes(date, time);

    const utcMs =
        Date.UTC(year, month - 1, day, Number(hh), Number(mm), Number(ss)) -
        offsetMinutes * 60 * 1000;

    return new Date(utcMs).toISOString();
}

function utcToNyDateTimeParts(isoUtc) {
    const d = new Date(isoUtc);
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: NY_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(d);

    const get = type => parts.find(p => p.type === type)?.value || '';
    return {
        date: `${get('year')}-${get('month')}-${get('day')}`,
        time: `${get('hour')}:${get('minute')}`,
        timeSec: `${get('hour')}:${get('minute')}:${get('second')}`,
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// Numeric helpers
// ──────────────────────────────────────────────────────────────────────────────
function toNum(v) {
    if (v === '' || v == null) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function round4(v) {
    if (v == null || !Number.isFinite(v)) return v;
    return Number(v.toFixed(4));
}

function sma(values, period, idx) {
    if (idx + 1 < period) return 0;
    let sum = 0;
    for (let i = idx - period + 1; i <= idx; i++) sum += values[i];
    return sum / period;
}

function computeEMA(values, period) {
    const out = new Array(values.length).fill(0);
    if (!values.length) return out;

    const k = 2 / (period + 1);

    if (values.length < period) {
        let prev = values[0] || 0;
        out[0] = prev;
        for (let i = 1; i < values.length; i++) {
            prev = values[i] * k + prev * (1 - k);
            out[i] = prev;
        }
        return out;
    }

    let seed = 0;
    for (let i = 0; i < period; i++) seed += values[i];
    seed /= period;

    for (let i = 0; i < period - 1; i++) out[i] = 0;
    out[period - 1] = seed;

    let prev = seed;
    for (let i = period; i < values.length; i++) {
        prev = values[i] * k + prev * (1 - k);
        out[i] = prev;
    }

    return out;
}

async function findProfile(symbol) {
    const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=d2389shr01qgiro2fd9gd2389shr01qgiro2fda0`;
    const res = await axios.get(url, { timeout: 8000 });
    const profile = res.data ?? {};

    const so = profile.shareOutstanding;
    const sharesOutstanding = typeof so === 'number' && !isNaN(so) ? so * 1_000_000 : null;

    const mc = profile.marketCapitalization;
    const marketCap = typeof mc === 'number' && !isNaN(mc) ? mc : null;

    return { sharesOutstanding, marketCap };
}

function computeATR(rows, period = 14) {
    const tr = new Array(rows.length).fill(0);
    const atr = new Array(rows.length).fill(0);

    if (rows.length < 2) return atr;

    // TR igual al primer cálculo
    for (let i = 1; i < rows.length; i++) {
        const h = Number(rows[i].high);
        const l = Number(rows[i].low);
        const prevClose = Number(rows[i - 1].close);

        const tr1 = h - l;
        const tr2 = Math.abs(h - prevClose);
        const tr3 = Math.abs(l - prevClose);

        tr[i] = Math.max(tr1, tr2, tr3);
    }

    // ATR candle-by-candle usando SMA de los últimos period TR
    for (let i = 1; i < rows.length; i++) {
        const start = Math.max(1, i - period + 1);
        const slice = tr.slice(start, i + 1);
        atr[i] = slice.reduce((s, v) => s + v, 0) / slice.length;
    }

    return atr;
}

function computeRSI(closes, period = 14) {
    const rsi = new Array(closes.length).fill(0);
    if (closes.length < 2) return rsi;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= Math.min(period, closes.length - 1); i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff;
        else losses += Math.abs(diff);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = 1; i < closes.length; i++) {
        if (i > period) {
            const diff = closes[i] - closes[i - 1];
            const gain = diff > 0 ? diff : 0;
            const loss = diff < 0 ? Math.abs(diff) : 0;
            avgGain = ((avgGain * (period - 1)) + gain) / period;
            avgLoss = ((avgLoss * (period - 1)) + loss) / period;
        }

        if (i < period) {
            rsi[i] = 0;
            continue;
        }

        if (avgLoss === 0) {
            rsi[i] = 100;
            continue;
        }

        const rs = avgGain / avgLoss;
        rsi[i] = 100 - (100 / (1 + rs));
    }

    return rsi;
}

function stddev(values) {
    if (!values.length) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
        values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
}

function getSession(minute) {
    return minute < 570
        ? 'PRE_MARKET'
        : minute < 600
            ? 'THE_OPEN'
            : minute < 690
                ? 'LATE_MORNING'
                : minute < 900
                    ? 'MIDDAY'
                    : minute < 960
                        ? 'THE_CLOSE'
                        : 'AFTER_HOURS';
}

// ──────────────────────────────────────────────────────────────────────────────
// Alpaca fetch
// ──────────────────────────────────────────────────────────────────────────────
async function fetchBarsFromAlpaca(symbol, nyDate) {
    const startUtc = nyLocalToUtcIso(nyDate, '00:00:00');
    const endUtc = nyLocalToUtcIso(nyDate, '23:59:59');

    const url =
        `https://data.alpaca.markets/v2/stocks/bars` +
        `?symbols=${encodeURIComponent(symbol)}` +
        `&timeframe=1Min` +
        `&start=${encodeURIComponent(startUtc)}` +
        `&end=${encodeURIComponent(endUtc)}` +
        `&adjustment=split` +
        `&sort=asc` +
        `&limit=10000`;

    const response = await axios.request({
        method: 'get',
        maxBodyLength: Infinity,
        url,
        headers: {
            'APCA-API-KEY-ID': APCA_API_KEY_ID,
            'APCA-API-SECRET-KEY': APCA_API_SECRET_KEY,
        },
    });

    return response?.data?.bars?.[symbol] || [];
}

// ──────────────────────────────────────────────────────────────────────────────
// SAME feature engineering logic as your original file
// ──────────────────────────────────────────────────────────────────────────────
async function buildRowsFromBars(symbol, nyDate, bars, fromTime = null, toTime = null) {
    if (!bars.length) return [];

    const allNormalized = bars
        .map((b) => {
            const p = utcToNyDateTimeParts(b.t);
            return {
                symbol,
                date: p.date,
                candle_time_et: p.time,
                open: toNum(b.o),
                high: toNum(b.h),
                low: toNum(b.l),
                close: toNum(b.c),
                volume: toNum(b.v),
                rawTime: b.t,
            };
        })
        .filter(r => r.date === nyDate)
        .sort((a, b) => new Date(a.rawTime) - new Date(b.rawTime));

    if (!allNormalized.length) return [];

    const closes = allNormalized.map(r => r.close);
    const volumes = allNormalized.map(r => r.volume);

    const ema9 = computeEMA(closes, 9);
    const ema20 = computeEMA(closes, 20);
    const atr = computeATR(allNormalized, 14);
    const rsi = computeRSI(closes, 14);

    const firstRegularIndex = allNormalized.findIndex(
        r => timeToMin(r.candle_time_et) >= REGULAR_OPEN_MIN
    );
    const openDay = allNormalized[0]?.open || 0;
    const openFirst = firstRegularIndex >= 0 ? allNormalized[firstRegularIndex].open : openDay;

    const allRows = [];
    let cumulativeTypicalPV = 0;
    let cumulativeVol = 0;

    let highOfDaySoFar = -Infinity;
    let lowOfDaySoFar = Infinity;
    let preMarketHighSoFar = 0;
    let premarketVolumeSoFar = 0;
    let hodIndex = -1;

    const { sharesOutstanding, marketCap } = await findProfile(symbol);


    for (let i = 0; i < allNormalized.length; i++) {
        const row = allNormalized[i];
        const minute = timeToMin(row.candle_time_et);
        const isPremarket = minute < REGULAR_OPEN_MIN;
        const prevHighOfDay = Number.isFinite(highOfDaySoFar) ? highOfDaySoFar : 0;

        const typicalPrice = (row.high + row.low + row.close) / 3;
        cumulativeTypicalPV += typicalPrice * row.volume;
        cumulativeVol += row.volume;

        if (isPremarket) {
            preMarketHighSoFar = Math.max(preMarketHighSoFar, row.high);
            premarketVolumeSoFar += row.volume;
        }

        if (row.high >= highOfDaySoFar) {
            highOfDaySoFar = row.high;
            hodIndex = i;
        }

        lowOfDaySoFar = Math.min(lowOfDaySoFar, row.low);

        const prevClose = i >= 1 ? allNormalized[i - 1].close : row.close;
        const prev5 = i >= 5 ? allNormalized[i - 5].close : 0;
        const prev10 = i >= 10 ? allNormalized[i - 10].close : 0;

        const dollarVolume = row.close * row.volume;

        const volumeAvg20 = i >= 19
            ? volumes.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20
            : volumes.slice(0, i + 1).reduce((a, b) => a + b, 0) / Math.max(1, i + 1);

        const dollarVolAvg20 = i >= 19
            ? allRows.slice(i - 19, i).reduce((sum, item) => sum + item.dollar_volume, 0) / 19
            : allRows.slice(0, i).reduce((sum, item) => sum + item.dollar_volume, 0) / Math.max(1, i);

        const ret1 =
            i >= 1 && allNormalized[i - 1].close > 0
                ? (row.close / allNormalized[i - 1].close) - 1
                : 0;
        const ret2 =
            i >= 2 && allNormalized[i - 2].close > 0
                ? (row.close / allNormalized[i - 2].close) - 1
                : 0;
        const ret3 =
            i >= 3 && allNormalized[i - 3].close > 0
                ? (row.close / allNormalized[i - 3].close) - 1
                : 0;

        const vol15 = i >= 14
            ? stddev(
                allNormalized.slice(i - 14, i + 1).map((r, idx, arr) => {
                    if (idx === 0) return 0;
                    return arr[idx - 1].close > 0 ? (r.close / arr[idx - 1].close) - 1 : 0;
                })
            )
            : 0;

        const vwap = cumulativeVol > 0 ? cumulativeTypicalPV / cumulativeVol : 0;

        const gapPct =
            !isPremarket && openFirst > 0 && openDay > 0
                ? (openFirst - openDay) / openDay
                : 0;

        const changePct = priorClose > 0 ? (c.c - priorClose) / priorClose : 0;

        allRows.push({
            symbol,
            date: row.date,
            candle_time_et: row.candle_time_et,
            candle_idx: i,
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            volume: row.volume,

            atr: atr[i] || 0,
            vwap,
            high_of_day: highOfDaySoFar,
            low_of_day: lowOfDaySoFar,
            change_pct_at_candle: openDay > 0 ? (row.close - openDay) / openDay : 0,
            ema9: ema9[i] || 0,
            ema20: ema20[i] || 0,
            pre_market_high: preMarketHighSoFar,
            session: getSession(minute),

            shares_outstanding: sharesOutstanding,
            market_cap: marketCap,
            gap_pct: gapPct,
            premarket_volume: premarketVolumeSoFar,

            momentum_acumulado: openDay > 0 ? (row.close - openDay) / openDay : 0,
            change_1m: prevClose > 0 ? (row.close - prevClose) / prevClose : 0,
            change_5m: prev5 > 0 ? (row.close - prev5) / prev5 : 0,
            change_10m: prev10 > 0 ? (row.close - prev10) / prev10 : 0,
            minutes_since_hod: hodIndex >= 0 ? i - hodIndex : 0,
            volume_rel: volumeAvg20 > 0 ? row.volume / volumeAvg20 : 0,
            dist_vwap_pct: vwap > 0 ? (row.close - vwap) / vwap : 0,
            atr_rel: row.close > 0 ? (atr[i] || 0) / row.close : 0,
            minute_of_day: minute,
            rsi: rsi[i] || 0,
            volatility_15m: vol15,

            mom_5: prev5 > 0 ? (row.close / prev5) - 1 : 0,
            mom_10: prev10 > 0 ? (row.close / prev10) - 1 : 0,
            return_lag_1: ret1,
            return_lag_2: ret2,
            return_lag_3: ret3,

            dist_hod_pct: highOfDaySoFar > 0 ? (row.close - highOfDaySoFar) / highOfDaySoFar : 0,
            dist_lod_pct: lowOfDaySoFar > 0 ? (row.close - lowOfDaySoFar) / lowOfDaySoFar : 0,
            dist_pm_high: preMarketHighSoFar > 0 ? (row.close - preMarketHighSoFar) / preMarketHighSoFar : 0,

            break_hod: prevHighOfDay > 0 && row.high > prevHighOfDay ? 1 : 0,
            break_pm_high: preMarketHighSoFar > 0 && row.high > preMarketHighSoFar ? 1 : 0,

            range_expansion: row.open > 0 ? (row.high - row.low) / row.open : 0,
            float_rotation: 0,
            dollar_volume: dollarVolume,
            relative_dollar_volume: dollarVolAvg20 > 0 ? dollarVolume / dollarVolAvg20 : 0,
            volume_spike: volumeAvg20 > 0 && row.volume >= volumeAvg20 * 2 ? 1 : 0,
            vwap_cross_up:
                i > 0 && allRows[i - 1].close < allRows[i - 1].vwap && row.close >= vwap ? 1 : 0,
            dist_ema9: ema9[i] > 0 ? (row.close - ema9[i]) / ema9[i] : 0,
            dist_ema20: ema20[i] > 0 ? (row.close - ema20[i]) / ema20[i] : 0,

            momentum_acceleration:
                i >= 2 && allNormalized[i - 1].close > 0 && allNormalized[i - 2].close > 0
                    ? ((row.close - allNormalized[i - 1].close) / allNormalized[i - 1].close) -
                    ((allNormalized[i - 1].close - allNormalized[i - 2].close) / allNormalized[i - 2].close)
                    : 0,

            is_open: minute >= 570 && minute < 600 ? 1 : 0,
            is_midday: minute >= 690 && minute < 900 ? 1 : 0,
            is_power_hour: minute >= 900 && minute <= 960 ? 1 : 0,
            dist_gap: gapPct,
            relative_range: row.close > 0 ? (row.high - row.low) / row.close : 0,

            future_return_5m: 0,
            target: 0,
            target_break_hod_5m: 0,
            max_future_return_10m: 0,
        });
    }

    for (let i = 0; i < allRows.length; i++) {
        const refClose = allRows[i].close;
        const future5 = allRows.slice(i + 1, i + 6);
        const future10 = allRows.slice(i + 1, i + 11);

        const close5 = future5.length ? future5[future5.length - 1].close : refClose;
        const maxHigh10 = future10.length ? Math.max(...future10.map(r => r.high)) : refClose;

        allRows[i].future_return_5m = refClose > 0 ? (close5 - refClose) / refClose : 0;
        allRows[i].max_future_return_10m = refClose > 0 ? (maxHigh10 - refClose) / refClose : 0;
        allRows[i].target = allRows[i].future_return_5m > 0 ? 1 : 0;

        const priorHod = i > 0 ? allRows[i - 1].high_of_day : 0;
        allRows[i].target_break_hod_5m =
            priorHod > 0 && future5.some(r => r.high > priorHod) ? 1 : 0;
    }

    return allRows.filter(r => isWithinTimeRange(r.candle_time_et, fromTime, toTime));
}

// ──────────────────────────────────────────────────────────────────────────────
// MySQL compare
// ──────────────────────────────────────────────────────────────────────────────
function normalizeMysqlRow(row) {
    return {
        ...row,
        symbol: row.symbol == null ? null : String(row.symbol),
        date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date),
        candle_time_et: row.candle_time_et == null ? null : String(row.candle_time_et).slice(0, 5),
    };
}

function normalizeJsonRow(row) {
    return {
        ...row,
        symbol: row.symbol == null ? null : String(row.symbol),
        date: row.date == null ? null : String(row.date),
        candle_time_et: row.candle_time_et == null ? null : String(row.candle_time_et).slice(0, 5),
    };
}

function rowKey(row) {
    return `${row.symbol}__${row.date}__${row.candle_idx}`;
}

function comparableValue(v) {
    if (v == null) return null;

    if (typeof v === 'number') {
        return round4(v);
    }

    if (typeof v === 'string') {
        const trimmed = v.trim();
        if (!trimmed) return trimmed;

        const asNum = Number(trimmed);
        if (!Number.isNaN(asNum)) return round4(asNum);

        return trimmed;
    }

    return v;
}

function valuesEqual(a, b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return a === b;
}

async function fetchMysqlRows(connection, symbol, date, fromTime = null, toTime = null) {
    let sql = `
    SELECT *
    FROM training_1m
    WHERE symbol = ?
      AND date = ?
  `;

    const params = [symbol, date];

    if (fromTime) {
        sql += ` AND candle_time_et >= ?`;
        params.push(fromTime);
    }

    if (toTime) {
        sql += ` AND candle_time_et <= ?`;
        params.push(toTime);
    }

    sql += ` ORDER BY candle_idx ASC`;

    const [rows] = await connection.execute(sql, params);
    return rows.map(normalizeMysqlRow);
}

function buildDiff(calculatedRows, mysqlRows, fromTime = null, toTime = null) {
    const calcMap = new Map();
    const mysqlMap = new Map();

    for (const row of calculatedRows) {
        const norm = normalizeJsonRow(row);
        calcMap.set(rowKey(norm), norm);
    }

    for (const row of mysqlRows) {
        mysqlMap.set(rowKey(row), row);
    }

    const calcKeys = new Set(calcMap.keys());
    const mysqlKeys = new Set(mysqlMap.keys());

    const missing_in_mysql = [];
    const missing_in_calculated = [];
    const field_differences = [];

    for (const key of calcKeys) {
        if (!mysqlKeys.has(key)) {
            const row = calcMap.get(key);
            missing_in_mysql.push({
                symbol: row.symbol,
                date: row.date,
                candle_idx: row.candle_idx,
                candle_time_et: row.candle_time_et,
                reason: 'exists_in_calculated_but_not_in_mysql',
            });
        }
    }

    for (const key of mysqlKeys) {
        if (!calcKeys.has(key)) {
            const row = mysqlMap.get(key);
            missing_in_calculated.push({
                symbol: row.symbol,
                date: row.date,
                candle_idx: row.candle_idx,
                candle_time_et: row.candle_time_et,
                reason: 'exists_in_mysql_but_not_in_calculated',
            });
        }
    }

    for (const key of calcKeys) {
        if (!mysqlKeys.has(key)) continue;

        const calcRow = calcMap.get(key);
        const mysqlRow = mysqlMap.get(key);

        const fields = Object.keys(calcRow);
        const diffs = [];

        for (const field of fields) {
            if (!(field in mysqlRow)) continue;

            const left = comparableValue(calcRow[field]);
            const right = comparableValue(mysqlRow[field]);

            if (!valuesEqual(left, right)) {
                diffs.push({
                    field,
                    calculated: left,
                    mysql: right,
                    delta:
                        typeof left === 'number' && typeof right === 'number'
                            ? round4(left - right)
                            : null,
                });
            }
        }

        if (diffs.length) {
            field_differences.push({
                symbol: calcRow.symbol,
                date: calcRow.date,
                candle_idx: calcRow.candle_idx,
                candle_time_et: calcRow.candle_time_et || mysqlRow.candle_time_et,
                differences: diffs,
            });
        }
    }

    return {
        summary: {
            symbol: ticker,
            date: dateStr,
            from_time: fromTime,
            to_time: toTime,
            calculated_rows: calculatedRows.length,
            mysql_rows: mysqlRows.length,
            missing_in_mysql_count: missing_in_mysql.length,
            missing_in_calculated_count: missing_in_calculated.length,
            rows_with_field_differences_count: field_differences.length,
        },
        missing_in_mysql,
        missing_in_calculated,
        field_differences,
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────
async function main() {
    if (!ticker) {
        console.error('Usage: node debug-diff-alpaca-vs-mysql.js TICKER DATE [FROM] [TO] [output.json]');
        process.exit(1);
    }

    let connection;

    try {
        const bars = await fetchBarsFromAlpaca(ticker, dateStr);

        if (!bars.length) {
            console.error(`No Alpaca bars for ${ticker} on ${dateStr}`);
            process.exit(1);
        }

        const calculatedRows = await buildRowsFromBars(ticker, dateStr, bars, fromTime, toTime);

        if (!calculatedRows.length) {
            console.error(
                `No calculated rows for ${ticker} on ${dateStr}${fromTime || toTime ? ` in range ${fromTime || 'start'}-${toTime || 'end'}` : ''
                }`
            );
            process.exit(1);
        }

        connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST || '127.0.0.1',
            port: Number(process.env.MYSQL_PORT || 3306),
            user: process.env.MYSQL_USER || 'root',
            password: process.env.MYSQL_PASSWORD || 'sbrQp10',
            database: process.env.MYSQL_DATABASE || 'stock_training',
            decimalNumbers: true,
        });

        const mysqlRows = await fetchMysqlRows(connection, ticker, dateStr, fromTime, toTime);
        const diff = buildDiff(calculatedRows, mysqlRows, fromTime, toTime);

        fs.writeFileSync(outPath, JSON.stringify(diff, null, 2));

        console.log(`\nDiff generated for ${ticker} ${dateStr}`);
        if (fromTime || toTime) {
            console.log(`Range          : ${fromTime || 'start'} -> ${toTime || 'end'}`);
        } else {
            console.log('Range          : full day');
        }
        console.log(`Calculated rows: ${diff.summary.calculated_rows}`);
        console.log(`MySQL rows     : ${diff.summary.mysql_rows}`);
        console.log(`Missing in MySQL      : ${diff.summary.missing_in_mysql_count}`);
        console.log(`Missing in calculated : ${diff.summary.missing_in_calculated_count}`);
        console.log(`Rows with field diffs : ${diff.summary.rows_with_field_differences_count}`);
        console.log(`Output: ${outPath}\n`);
    } catch (e) {
        console.error(e?.response?.data || e.message || e);
        process.exit(1);
    } finally {
        if (connection) {
            try {
                await connection.end();
            } catch (_) { }
        }
    }
}

main();