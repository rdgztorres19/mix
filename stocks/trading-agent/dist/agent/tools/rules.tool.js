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
const _smallcaptrading = require("../../small-cap-trading");
function createRulesTool() {
    return (0, _tools.tool)(async ({ ticker, price, vwap, ema9, ema20, relative_volume, change_pct, atr, session, pre_market_high, account_size, last_candles_json })=>{
        const result = (0, _smallcaptrading.applyTradingRules)({
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

//# sourceMappingURL=rules.tool.js.map