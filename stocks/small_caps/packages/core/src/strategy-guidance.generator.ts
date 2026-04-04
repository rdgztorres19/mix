import type { StrategyGuidance } from '@small-caps/shared';

/**
 * Generates what-to-watch / confirmation / invalidation guidance for each strategy.
 * Ported from trading-agent/src/small-cap-trading/strategy-guidance.generator.ts
 */
export class StrategyGuidanceGenerator {
  private static readonly GUIDANCE: Record<string, StrategyGuidance> = {
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
      knowledge_summary: 'ORB: first 5-min candle defines range. Long above range high, short below range low. Stop at VWAP. Target: next technical level.',
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
      knowledge_summary: 'VWAP False Breakout: stock loses VWAP after being strong → short. Or weak stock squeezes above VWAP → long.',
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
      session_context: 'Best in MIDDAY and THE CLOSE. Does not require fast execution.',
      knowledge_summary: 'VWAP MA Trend: above VWAP + MA support → buy pullbacks to MA. Below VWAP + MA resistance → short bounces.',
    },
    FALLEN_ANGEL: {
      what_to_watch: 'Stock made HOD at open then sold off. Wait for consolidation around support. Entry on new 1-min/5-min high with massive volume.',
      confirmation_signals: [
        'Pre-market volume 1M+ shares',
        'HOD made early then sharp sell-off',
        'Consolidation forming at key support level',
        'Massive volume spike on breakout candle',
      ],
      invalidation: 'Stock drops below consolidation low. Avoid first uptick at open — usually a trap.',
      session_context: 'THE OPEN only. High difficulty strategy. Use small size.',
      knowledge_summary: 'Fallen Angel: gap up → HOD at open → sell-off → consolidation → breakout on huge volume. Stop below consolidation.',
    },
    VWAP_LATE_MORNING: {
      what_to_watch: 'Stock holding above VWAP in late morning with 9 EMA or 20 EMA acting as support. Enter on pullback to VWAP or MA.',
      confirmation_signals: [
        'Price stays above VWAP after morning sell-off',
        'Pullback to VWAP/EMA9 holds as support',
        'Volume decreasing on pullback, increasing on bounce',
        'HH/HL pattern intact on 5-min chart',
      ],
      invalidation: 'Price breaks below VWAP on high volume. If no bounce within 5 candles, exit.',
      session_context: 'LATE MORNING only (11:00-12:30). Best when morning trend is confirmed.',
      knowledge_summary: 'VWAP Late Morning: stock above VWAP + MA support in late morning → buy pullback. Stop below VWAP. Targets above.',
    },
    // ── Warrior Trading Strategies ──
    WT_BULL_FLAG: {
      what_to_watch: '3+ green candles moving up followed by 2+ red candles that cannot break the previous high. Perfect 5-min bull flag pulls back to 9 EMA.',
      confirmation_signals: ['Flag does not retrace more than 50% of the original move', 'Consolidation holds above 9 EMA on 5-min', '1-min MACD positive', 'Volume decreasing during flag'],
      invalidation: 'Price breaks below consolidation low. If not profitable immediately, bail out. Choppy = out!',
      session_context: 'Best on first and second pullback after a strong move. 3rd+ pullbacks are riskier.',
      knowledge_summary: 'WT Bull Flag: 3+ green → 2+ red consolidation → breakout. Entry on first candle to make new high. Stop 5-10-20 cents. Target 10-20-40 cents.',
    },
    WT_FLAT_TOP: {
      what_to_watch: '3+ green candles up sharply → 2+ candles of sideways consolidation at or near HOD. Common at half/whole dollars.',
      confirmation_signals: ['Consolidation rests on 9 EMA', 'Flat top at HOD or psychological level', 'Volume building during consolidation', 'No big sellers on Level 2'],
      invalidation: 'Price breaks below consolidation. Double top rejection.',
      session_context: 'THE_OPEN or LATE_MORNING. Best on leading gapper.',
      knowledge_summary: 'WT Flat Top: consolidation at HOD → breakout. Entry at apex. Stop low of pattern. Target 15-25 cents.',
    },
    WT_ABCD: {
      what_to_watch: 'Big move up → first bull flag fails (point B) → pullback to 9 EMA (point C) → entry on break of point B. Long consolidation traps short sellers.',
      confirmation_signals: ['Consolidation above 9 EMA', '1-min ABCD = typically a 5-min bull flag (multi-time frame)', 'Volume coiling before breakout', 'Short sellers trapped above point B'],
      invalidation: 'Price breaks below point C. Failed double top.',
      session_context: 'THE_OPEN, LATE_MORNING. ABCD is more powerful than bull flag due to longer consolidation.',
      knowledge_summary: 'WT ABCD: failed bull flag → consolidation → breakout at B. Entry at B, stop below C. Target HOD + squeeze.',
    },
    WT_FIRST_PULLBACK: {
      what_to_watch: 'Leading gapper strong into opening bell. First pullback after open. Enter on first candle to make new high at apex of bull flag / flat top.',
      confirmation_signals: ['Stock is the leading gapper', 'Strong pre-market volume', 'Price holds above VWAP', 'Enter early to anticipate breakout at half/whole dollar below apex'],
      invalidation: 'Price moves down immediately after entry = timing wrong. Choppy action = exit. If red immediately, change perspective to breakeven exit.',
      session_context: 'THE_OPEN only. One of the lower risk gap-and-go setups.',
      knowledge_summary: 'WT First Pullback: first flag after gap open. Tight stops. Target retest HOD + squeeze. Breakout or bailout!',
    },
    WT_MA_PULLBACK: {
      what_to_watch: 'Stock failed to resolve as bull flag AND failed as ABCD. Now grinding on 9/20 EMA. Enter close to actual 9 EMA or on first sign of curling up.',
      confirmation_signals: ['Stock holds above 9 EMA on 5-min', 'Volume coming back', 'Slight curling up with higher lows', 'Grinder pattern — slow but steady move higher'],
      invalidation: 'Stock stalls out completely or breaks below 9 EMA support. If slow to breakout, move on.',
      session_context: 'THE_OPEN, LATE_MORNING. More common on higher float stocks. Harder for beginners.',
      knowledge_summary: 'WT MA Pullback: failed bull flag + ABCD → grinds on 9/20 EMA. Entry at MA, stop below. Target HOD.',
    },
    WT_PM_HIGH_BREAK: {
      what_to_watch: 'Strong gapper approaching pre-market highs. Short sellers cover and long traders enter on break of PM high. Look for green on tape.',
      confirmation_signals: ['Stock is leading gapper', 'Float under 10M shares', 'No big sellers on Level 2', 'Green buy orders surging on tape'],
      invalidation: 'Stock hesitates at PM high = exit to avoid false breakout. If not instant winner, bail.',
      session_context: 'THE_OPEN. Strongest on leading gapper with low float. More aggressive in hot market.',
      knowledge_summary: 'WT PM High Break: buy break of pre-market high. Target continuation 15-25 cents. Breakout or bailout!',
    },
    WT_HALF_WHOLE_DOLLAR: {
      what_to_watch: 'Price approaching $X.50 or $X.00 from below. These are psychological S/R levels where short sellers place stops.',
      confirmation_signals: ['Break through half/whole dollar is clean with volume', 'Green orders on tape', 'Combined with another setup (first pullback, flat top)', 'Stock between $5-$10 works best'],
      invalidation: 'Price immediately rejects at the level. Short sellers hold strong.',
      session_context: 'THE_OPEN, LATE_MORNING. Does NOT work in slow market. Hot market only.',
      knowledge_summary: 'WT Half/Whole Dollar: entry near $X.50/$X.00, stop just below. Target 15-25 cents continuation.',
    },
    WT_RED_TO_GREEN: {
      what_to_watch: 'Stock opened red (below prev close or first candle red). Now reversing through opening price. Short sellers trapped in bear trap.',
      confirmation_signals: ['Sudden explosive rip through open price', 'Short covering visible', 'Momentum traders buying pullbacks', 'Strong volume on the reversal candle'],
      invalidation: 'Bull trap — pops through open then immediately rejects back to lows. Keep tight stops!',
      session_context: 'THE_OPEN. Powerful setup when it works. Early weakness is caution flag.',
      knowledge_summary: 'WT Red to Green: stock opens red → reverses through open → squeezes to HOD and PM highs. Tight stops 5-10-20 cents.',
    },
    WT_MICRO_PULLBACK: {
      what_to_watch: '1-candle dip on a stock surging up 10%+ in last 5-10 min. Near halt levels. Parabolic stocks only.',
      confirmation_signals: ['Green buy orders on tape during pullback', 'Large seller thinning out', 'Stock is obvious — many traders watching', 'Float under 10M, hot market'],
      invalidation: 'Low volume during pullback or red orders dominating tape. If light volume, flush risk is high.',
      session_context: 'THE_OPEN, LATE_MORNING. Most common setup for parabolic stocks. Requires Level 2 and fast execution.',
      knowledge_summary: 'WT Micro Pullback: 1-candle dip on parabolic move. Entry on green tape, stop low of pullback candle. Target HOD + halt.',
    },
    WT_VWAP_BREAKOUT: {
      what_to_watch: 'Stock below VWAP with early weakness. Sudden break above VWAP forces swing trade + day trade short covering = double/triple buying.',
      confirmation_signals: ['Surge through VWAP on volume', '1-min micro pullback holds above VWAP', 'Short sellers trapped below', 'Stock meets all criteria: low float, up 100%+'],
      invalidation: 'Bull trap at VWAP — flushes back below VWAP. Panic long sellers + shorts add = flush to LOD or halt down.',
      session_context: 'THE_OPEN, LATE_MORNING, MIDDAY. Can become parabolic on low float. Stop just below VWAP.',
      knowledge_summary: 'WT VWAP Breakout: break above VWAP from below. Short squeeze potential. Target HOD + halt. Stop below VWAP.',
    },
    WT_HOD_BREAK: {
      what_to_watch: 'Price at or just below HOD. Short sellers have stops above HOD. Break through = quick squeeze from short covering.',
      confirmation_signals: ['Green on tape as approaching HOD', 'Short sellers starting to cover before break', 'Combined with half/whole dollar or micro pullback', 'Stock is obvious with significant rate of change'],
      invalidation: 'Double top rejection. Stock extended or running into daily resistance (200 EMA).',
      session_context: 'THE_OPEN, LATE_MORNING. Most aggressive entry — buying at the high. Need a cushion on the day.',
      knowledge_summary: 'WT HOD Break: buy at/near HOD. Short covering fuels breakout. Target 25-50 cents. Breakout or bailout!',
    },
  };

  generate(strategyName: string | null): StrategyGuidance | null {
    if (!strategyName) return null;
    const key = strategyName.split(' · ')[0];
    return StrategyGuidanceGenerator.GUIDANCE[key] ?? null;
  }
}
