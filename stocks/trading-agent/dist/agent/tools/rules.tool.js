// @ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "createRulesTool", {
    enumerable: true,
    get: function() {
        return createRulesTool;
    }
});
const _tools = require("@langchain/core/tools");
const _zod = require("zod");
function createRulesTool() {
    return (0, _tools.tool)(async ({ ticker, price, vwap, ema9, ema20, relative_volume, change_pct, atr, session, pre_market_high, account_size, last_candles_json })=>{
        const result = applyTradingRules({
            ticker,
            price,
            vwap,
            ema9,
            ema20,
            relative_volume,
            change_pct,
            atr,
            session,
            pre_market_high,
            account_size,
            last_candles_json
        });
        if (!result.viable) {
            return `RULES VERDICT: NO_TRADE
Hard stops triggered:
${result.hard_stops.map((s)=>`  ❌ ${s}`).join('\n')}

${result.verdict}`;
        }
        const lines = [
            `RULES VERDICT: POTENTIAL_SETUP`,
            `Session: ${result.session}`,
            `Identified Strategy: ${result.identified_strategy || 'UNCLEAR'}`,
            ``,
            `Pattern Signals Detected:`,
            ...result.pattern_signals.map((s)=>`  ✅ ${s}`),
            ``,
            `Calculated Levels:`,
            `  Entry Zone: ${result.entry_zone ? '$' + result.entry_zone.price.toFixed(2) + ' — ' + result.entry_zone.note : 'TBD'}`,
            `  Stop Loss: ${result.stop_loss ? '$' + result.stop_loss.price.toFixed(2) + ' — ' + result.stop_loss.note : 'TBD'}`,
            `  Target 1: ${result.target_1 ? '$' + result.target_1.price.toFixed(2) + ' — ' + result.target_1.note : 'TBD'}`,
            `  Target 2: ${result.target_2 ? '$' + result.target_2.price.toFixed(2) + ' — ' + result.target_2.note : 'TBD'}`,
            ``,
            `Position Sizing (Max 2% risk):`,
            `  Account: $${account_size.toLocaleString()}`,
            `  Max Risk: $${result.risk_amount?.toFixed(0) || 'N/A'}`,
            `  Share Size: ${result.share_size || 'N/A'} shares`,
            `  R/R Ratio: ${result.rr_ratio?.toFixed(1) || 'N/A'}:1`,
            ``,
            result.verdict
        ];
        return lines.join('\n');
    }, {
        name: 'apply_trading_rules',
        description: 'Applies deterministic trading rules from the knowledge base to evaluate a stock setup. ' + 'Given technical levels (price, VWAP, EMAs, volume, session), it: ' + '1) Identifies the likely trading strategy (Bull Flag, ABCD, ORB, VWAP Reversal, etc.), ' + '2) Checks if the setup meets hard entry criteria, ' + '3) Calculates entry price, stop loss, profit targets, and position size based on 2% max risk rule. ' + 'Returns a structured verdict: NO_TRADE or POTENTIAL_SETUP with full parameters.',
        schema: _zod.z.object({
            ticker: _zod.z.string().describe('Stock ticker symbol'),
            price: _zod.z.number().describe('Current price'),
            vwap: _zod.z.number().nullable().describe('Current VWAP value, or null if unavailable'),
            ema9: _zod.z.number().nullable().describe('9-period EMA on 5-min chart, or null'),
            ema20: _zod.z.number().nullable().describe('20-period EMA on 5-min chart, or null'),
            relative_volume: _zod.z.number().describe('Relative volume vs average (e.g. 12.5 = 12.5x)'),
            change_pct: _zod.z.number().describe('Percentage change today as decimal (e.g. 0.35 = 35%)'),
            atr: _zod.z.number().describe('14-day Average True Range in dollars'),
            session: _zod.z.string().describe('Trading session: PRE_MARKET, THE_OPEN, LATE_MORNING, MIDDAY, THE_CLOSE, AFTER_HOURS'),
            pre_market_high: _zod.z.number().nullable().describe('Pre-market high price, or null if unknown'),
            account_size: _zod.z.number().describe('Total account size in dollars for position sizing'),
            last_candles_json: _zod.z.string().optional().describe('JSON string of last 5 candles: [{o,h,l,c,v,t},...]. Used to detect Bull Flag / ABCD patterns.')
        })
    });
}
// ─── Core deterministic rule engine ──────────────────────────────────────────
function applyTradingRules(params) {
    const { price, vwap, ema9, ema20, relative_volume, change_pct, atr, session, pre_market_high, account_size, last_candles_json } = params;
    const hard_stops = [];
    const pattern_signals = [];
    // ── Hard stops: conditions that immediately disqualify the trade ──────────
    if (change_pct < 0.05) hard_stops.push('Change < 5%: not enough momentum');
    if (relative_volume < 3) hard_stops.push('Relative volume < 3x: insufficient interest');
    if (atr < 0.30) hard_stops.push('ATR < $0.30: price range too narrow');
    if (session === 'AFTER_HOURS') hard_stops.push('After hours: no live trading');
    if (price < 1) hard_stops.push('Price < $1: penny stock risk, skip');
    if (price > 30) hard_stops.push('Price > $30: outside low-float small cap zone');
    if (!vwap) hard_stops.push('VWAP unavailable: cannot assess directional bias');
    if (hard_stops.length > 0) {
        return {
            viable: false,
            session,
            identified_strategy: null,
            pattern_signals: [],
            hard_stops,
            entry_zone: null,
            stop_loss: null,
            target_1: null,
            target_2: null,
            share_size: null,
            risk_amount: null,
            rr_ratio: null,
            verdict: 'This stock does not meet minimum trading criteria. Do NOT trade.'
        };
    }
    // ── Pattern detection ─────────────────────────────────────────────────────
    let candles = [];
    try {
        if (last_candles_json) candles = JSON.parse(last_candles_json);
    } catch  {
        candles = [];
    }
    const aboveVwap = vwap && price > vwap;
    const aboveEma9 = ema9 && price > ema9;
    const aboveEma20 = ema20 && price > ema20;
    if (aboveVwap) pattern_signals.push(`Price above VWAP ($${vwap.toFixed(2)})`);
    if (aboveEma9) pattern_signals.push(`Price above EMA9 ($${ema9.toFixed(2)})`);
    if (aboveEma20) pattern_signals.push(`Price above EMA20 ($${ema20.toFixed(2)})`);
    if (relative_volume >= 5) pattern_signals.push(`Strong relative volume: ${relative_volume.toFixed(1)}x`);
    if (change_pct >= 0.20) pattern_signals.push(`Strong momentum: +${(change_pct * 100).toFixed(1)}% today`);
    // Detect Bull Flag pattern from last candles
    let bullFlagDetected = false;
    if (candles.length >= 4) {
        const last = candles.slice(-4);
        const poleCandles = last.slice(0, 2).filter((c)=>c.c > c.o);
        const flagCandles = last.slice(2).filter((c)=>c.c < c.o);
        if (poleCandles.length >= 1 && flagCandles.length >= 1) {
            const poleHigh = Math.max(...poleCandles.map((c)=>c.h));
            const flagLow = Math.min(...flagCandles.map((c)=>c.l));
            const retrace = (poleHigh - flagLow) / (poleHigh - candles[0].o);
            if (retrace < 0.5) {
                bullFlagDetected = true;
                pattern_signals.push(`Bull Flag detected: ${(retrace * 100).toFixed(0)}% retracement (< 50%)`);
            }
        }
    }
    // ── Strategy identification ────────────────────────────────────────────────
    let identified_strategy = null;
    let entry_price;
    let stop_price;
    let t1_price;
    let t2_price;
    if (session === 'THE_OPEN' && bullFlagDetected && aboveVwap) {
        identified_strategy = 'BULL_FLAG';
        entry_price = price + 0.02;
        stop_price = candles.length ? Math.min(...candles.slice(-2).map((c)=>c.l)) : price - atr * 0.3;
        t1_price = pre_market_high || price + atr * 0.5;
        t2_price = price + atr;
    } else if (session === 'THE_OPEN' && aboveVwap && aboveEma9) {
        identified_strategy = 'ABCD';
        entry_price = ema9 || price;
        stop_price = (ema9 || price) - atr * 0.25;
        t1_price = price + atr * 0.5;
        t2_price = pre_market_high || price + atr;
    } else if (session === 'THE_OPEN' && !aboveVwap) {
        identified_strategy = 'VWAP_REVERSAL';
        entry_price = vwap ? vwap - atr * 0.1 : price;
        stop_price = price - atr * 0.3;
        t1_price = vwap || price + atr * 0.3;
        t2_price = ema9 || price + atr * 0.6;
    } else if ((session === 'LATE_MORNING' || session === 'MIDDAY') && !aboveVwap) {
        identified_strategy = 'VWAP_FALSE_BREAKOUT';
        entry_price = vwap ? vwap + 0.02 : price;
        stop_price = vwap ? vwap - atr * 0.15 : price - atr * 0.2;
        t1_price = price + atr * 0.4;
        t2_price = price + atr * 0.8;
    } else if ((session === 'MIDDAY' || session === 'THE_CLOSE') && aboveVwap && aboveEma20) {
        identified_strategy = 'VWAP_MA_TREND';
        entry_price = ema20 || price;
        stop_price = (ema20 || price) - atr * 0.2;
        t1_price = price + atr * 0.4;
        t2_price = price + atr * 0.8;
    } else {
        identified_strategy = 'GENERAL';
        entry_price = price;
        stop_price = price - atr * 0.3;
        t1_price = price + atr * 0.5;
        t2_price = price + atr;
    }
    // ── Position sizing: 2% rule ───────────────────────────────────────────────
    const max_risk = account_size * 0.02;
    const per_share_risk = Math.max(entry_price - stop_price, 0.05);
    const share_size = Math.floor(max_risk / per_share_risk);
    const rr_ratio = (t1_price - entry_price) / per_share_risk;
    // Check minimum R/R ratio
    if (rr_ratio < 2) {
        pattern_signals.push(`⚠️ R/R ratio ${rr_ratio.toFixed(1)}:1 — below 2:1 minimum, consider skipping`);
    }
    return {
        viable: true,
        session,
        identified_strategy,
        pattern_signals,
        hard_stops: [],
        entry_zone: {
            price: entry_price,
            note: `${identified_strategy} entry`
        },
        stop_loss: {
            price: stop_price,
            note: 'Structural stop based on pattern'
        },
        target_1: {
            price: t1_price,
            note: 'First target — take 50% off'
        },
        target_2: {
            price: t2_price,
            note: 'Second target — let winners run'
        },
        share_size,
        risk_amount: max_risk,
        rr_ratio,
        verdict: `Setup looks viable. Strategy: ${identified_strategy}. Entry near $${entry_price.toFixed(2)}, stop at $${stop_price.toFixed(2)}, T1 at $${t1_price.toFixed(2)} (R/R ${rr_ratio.toFixed(1)}:1). Max ${share_size} shares.`
    };
}

//# sourceMappingURL=rules.tool.js.map