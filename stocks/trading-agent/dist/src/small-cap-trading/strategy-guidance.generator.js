"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StrategyGuidanceGenerator = void 0;
class StrategyGuidanceGenerator {
    generate(strategyName) {
        if (!strategyName)
            return null;
        const key = strategyName.split(' · ')[0];
        return StrategyGuidanceGenerator.GUIDANCE[key] ?? null;
    }
}
exports.StrategyGuidanceGenerator = StrategyGuidanceGenerator;
StrategyGuidanceGenerator.GUIDANCE = {
    BULL_FLAG: {
        what_to_watch: 'Wait for first candle to make a NEW HIGH after 2+ red consolidation candles. Volume must spike on the breakout candle.',
        confirmation_signals: [
            '1-min and 5-min charts both make new high simultaneously',
            'Volume decreases during flag (red candles), then surges on breakout',
            'Consolidation holds above 9 EMA on 5-min chart',
            'Flag retraces less than 50% of the pole move',
        ],
        invalidation: 'Price breaks below the consolidation low (flag low). If not profitable within 2 minutes, bail out.',
        session_context: 'Best during THE OPEN (9:30-10:30am). First or second consolidation is ideal; later ones are risky (overextended).',
        knowledge_summary: 'Bull Flag = 3+ green candles (pole) followed by 2+ red candles (flag). Entry on new high after flag. Stop below flag low. T1: HOD, T2: pre-market high.',
    },
    ABCD: {
        what_to_watch: 'Price holding at point C (higher low above A). Enter close to C as volume returns. Look for move from C toward D.',
        confirmation_signals: [
            'C is a higher low than A (C > A)',
            'Volume spikes at point D confirm breakout',
            'Consolidation at C occurs above 9 EMA',
            '1-min and 5-min timeframe alignment',
        ],
        invalidation: 'Price drops below point C. Exit immediately if C is lost.',
        session_context: 'Works during THE OPEN and LATE MORNING. A 1-min ABCD is typically a 5-min Bull Flag (multi-timeframe).',
        knowledge_summary: 'ABCD: A→B strong move, B→C pullback (C>A), C→D breakout. Enter near C, stop below C, T1 at D (point B level), T2 extension.',
    },
    ORB: {
        what_to_watch: 'Wait for stock to break above opening range HIGH (long) or below LOW (short) after first 5 minutes.',
        confirmation_signals: [
            'Opening range small relative to ATR',
            'High volume with many different orders (not block trades)',
            'Grinding/churning price action in the opening range',
            'Break is clean with volume surge',
        ],
        invalidation: 'Close below VWAP (longs) or above VWAP (shorts). If not profitable immediately, bail at breakeven.',
        session_context: 'THE OPEN only. Works better on mid-to-large cap stocks with higher floats, not volatile low-float.',
        knowledge_summary: 'ORB: first 5-min candle defines range. Long above range high, short below range low. Stop at VWAP. Target: next technical level (PM high, daily MAs).',
    },
    VWAP_REVERSAL: {
        what_to_watch: 'Stock fails to make new 5-min low (below VWAP) → sellers exhausted. Look for Higher Highs and Higher Lows forming.',
        confirmation_signals: [
            'Failed new 5-min low while below VWAP',
            'HH/HL pattern forming on 5-min chart',
            'Short covering visible (aggressive buying at ask)',
            'Volume increasing on bounce candles',
        ],
        invalidation: 'New low of day. If trade not working in 5 minutes, bail at breakeven.',
        session_context: 'Works during THE OPEN and LATE MORNING. Not all VWAP reversals are tradeable — skip if bad R/R.',
        knowledge_summary: 'VWAP Reversal: stock below VWAP fails new low → squeeze back to VWAP. Entry at failure, stop below LOD. T1: VWAP, T2: 9 EMA.',
    },
    VWAP_FALSE_BREAKOUT: {
        what_to_watch: 'Strong stock that loses VWAP in late morning signaling weakness. Or weak stock breaking above VWAP for short squeeze.',
        confirmation_signals: [
            'Stock traded above VWAP then failed to hold',
            'Drops back below VWAP with increasing sell volume',
            'No aggressive buying visible on Level 2',
            'Late morning timing (after 10:30am)',
        ],
        invalidation: 'Stock reclaims VWAP on high volume. Stop above VWAP for shorts.',
        session_context: 'Best in LATE MORNING and MIDDAY. Usually occurs after 10:30am when big buyers finish orders.',
        knowledge_summary: 'VWAP False Breakout: stock loses VWAP after being strong → short. Or weak stock squeezes above VWAP → long. Enter small, add on confirmation.',
    },
    VWAP_MA_TREND: {
        what_to_watch: 'Stock trending with 9 EMA or 20 EMA acting as support (above VWAP) or resistance (below VWAP).',
        confirmation_signals: [
            'Price pulls back to MA and bounces (long) or rejects (short)',
            'Entry very close to the MA line (small stop)',
            'Trend confirmed by VWAP position',
            'Multiple touches of MA as support/resistance',
        ],
        invalidation: 'Break of 9 EMA or 20 EMA. If stock moves very far from MA, take partial profit.',
        session_context: 'Best in MIDDAY and THE CLOSE. Does not require fast execution — entries/exits can be manual.',
        knowledge_summary: 'VWAP MA Trend: above VWAP + MA support → buy pullbacks to MA. Below VWAP + MA resistance → short bounces. Ride trend until MA break.',
    },
    FALLEN_ANGEL: {
        what_to_watch: 'Stock made HOD at open then sold off. Wait for consolidation around support (PM low, 5-min MAs). Entry on new 1-min/5-min high with massive volume.',
        confirmation_signals: [
            'Pre-market volume 1M+ shares',
            'HOD made early then sharp sell-off',
            'Consolidation forming at key support level',
            'Massive volume spike on breakout candle (significantly higher than previous)',
        ],
        invalidation: 'Stock drops below consolidation low. Avoid first uptick at open — usually a trap.',
        session_context: 'THE OPEN only. High difficulty strategy. Use small size. Best when stock recovers above VWAP and prior HOD.',
        knowledge_summary: 'Fallen Angel: gap up → HOD at open → sell-off → consolidation → breakout on huge volume. Stop below consolidation. T1: VWAP, T2: HOD, T3: PM high.',
    },
};
//# sourceMappingURL=strategy-guidance.generator.js.map