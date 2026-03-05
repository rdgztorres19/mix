export type Sesion = 'open' | 'late_morning' | 'midday' | 'close' | 'all';
export type TipoChunk = 'entrada' | 'salida' | 'caracteristicas' | 'riesgo' | 'psicologia' | 'scanner' | 'general';
export type Estrategia =
  | 'BULL_FLAG'
  | 'ABCD'
  | 'ORB'
  | 'VWAP_REVERSAL'
  | 'VWAP_FALSE_BREAKOUT'
  | 'VWAP_MA_TREND'
  | 'FALLEN_ANGEL'
  | 'GENERAL'
  | 'RISK_MANAGEMENT'
  | 'STOCK_SELECTION'
  | 'LEVEL2';

export interface KnowledgeChunk {
  id: string;
  text: string;
  estrategia: Estrategia;
  sesiones: Sesion[];
  tipo: TipoChunk;
}

export const KNOWLEDGE_CHUNKS: KnowledgeChunk[] = [
  // ─── STOCK SELECTION ──────────────────────────────────────────────────────
  {
    id: 'stock_selection_criteria',
    estrategia: 'STOCK_SELECTION',
    sesiones: ['all'],
    tipo: 'scanner',
    text: `5 Pillars of Stock Selection:
1. Price: Between $2-20 preferred.
2. Percentage Change Today: Up 10% or more versus prior day close.
3. Relative Volume: At least 5x above average volume today.
4. Catalyst: News catalyst or technical breakout on daily chart.
5. Float: Under 20 million shares preferred. Lower float = bigger % gains.
Pre-market Gappers Scanner criteria: Gap 2%+, pre-market volume 100K+, avg daily volume 500K+, ATR 50 cents+, fundamental catalyst required.`,
  },
  {
    id: 'stock_selection_float',
    estrategia: 'STOCK_SELECTION',
    sesiones: ['all'],
    tipo: 'caracteristicas',
    text: `Float and stock characteristics:
- Low float stocks (< 10M shares, price $1-$10): extremely volatile, 10-1000% daily moves possible, hard to short.
- Medium float stocks ($10-$100, 20M-500M shares): more stable, suitable for day trading.
- High relative volume stocks (Alpha stocks) move independently from sector/market - these are Stocks in Play.
- If volume is not higher than normal, the stock is likely dominated by institutions/HFT - avoid it.
- Only stocks with a fundamental catalyst (earnings, FDA, merger, etc.) qualify as true Stocks in Play.`,
  },
  {
    id: 'stock_selection_daily_chart',
    estrategia: 'STOCK_SELECTION',
    sesiones: ['all'],
    tipo: 'caracteristicas',
    text: `Indicators of a Strong Daily Chart for Small Cap Stocks:
1. Price should be above the 9 EMA and 20 EMA (gapper should gap above these).
2. Ideally also above 200 EMA (not required).
3. Large gaps and windows of no resistance.
4. No obvious ascending or descending resistance.
5. "Blue sky" aka all-time highs.
6. History of being a former runner creates bigger moves.
Daily windows with no resistance are "pockets" of opportunity - formed by large gaps or tall candles. Best setups have several big windows lined up.`,
  },

  // ─── BULL FLAG ────────────────────────────────────────────────────────────
  {
    id: 'bull_flag_characteristics',
    estrategia: 'BULL_FLAG',
    sesiones: ['open'],
    tipo: 'caracteristicas',
    text: `Bull Flag characteristics:
1. 3+ green candles moving up sharply (the pole).
2. 2 or more red candles following (the flag) - these candles cannot break the high of the previous candle.
3. A perfect 5-min bull flag pulls back to the 9 EMA on the 5-min chart.
4. The flag should NOT retrace more than 50% of the original move upside.
5. Volume decreases during the red consolidation candles (key confirmation).
The Bull Flag is essentially an ABCD Pattern but most often applied to low float stocks under $10. Forms and resolves much faster than ABCD.`,
  },
  {
    id: 'bull_flag_entry',
    estrategia: 'BULL_FLAG',
    sesiones: ['open'],
    tipo: 'entrada',
    text: `Bull Flag entry strategy:
- Entry point: first candle to make a NEW HIGH after 2 red candles, ideally when both 1-min and 5-min charts make new high simultaneously.
- Perfect entry is when 1-min high coincides with 5-min high both with strong volume.
- Do NOT chase the stock while it is running up (the pole phase). Wait for quiet consolidation.
- Early entry can be taken anticipating the breakout if: break through a psychological level (half/whole dollar) just below the apex, or a surge of buying on Level 2.
- Look for the stock on New High of Day Scanner: price $1-$10, min 200K daily volume, float ≤ 10M shares, 5-min relative volume 400-2000%, current volume ≥ 2x average.`,
  },
  {
    id: 'bull_flag_stop_target',
    estrategia: 'BULL_FLAG',
    sesiones: ['open'],
    tipo: 'salida',
    text: `Bull Flag stop loss and profit targets:
- Stop loss: breakdown below the consolidation period (low of the consolidation candles). Can be low of last 5-min candle or arbitrary 5-10-20 cents.
- Profit target 1: high of the day (new high breakout).
- Profit target 2: pre-market high.
- Sell half at first target, move stop to break-even for remainder.
- Exit if stock makes new low on 1-min or 5-min chart.
- Best opportunity: first or second consolidation. Later consolidations are risky (stock is overextended, buyers may lose control).
- If not profitable in first 2 minutes, bail out. Breakout or bailout rule.`,
  },

  // ─── ABCD PATTERN ─────────────────────────────────────────────────────────
  {
    id: 'abcd_characteristics',
    estrategia: 'ABCD',
    sesiones: ['open', 'late_morning'],
    tipo: 'caracteristicas',
    text: `ABCD Pattern characteristics:
- Point A to B: strong move up with buyers pushing to new highs.
- Point B: price extended, risky to enter. No clear stop loss.
- Point B to C: early buyers take profits, stock pulls back. C must be higher than A (higher low).
- Point C: support level higher than A - this is the entry point.
- Point C to D: price holds C and moves back up with high volume - entry signal.
- Volume spikes at point B and point D.
- A 1-min ABCD is typically a 5-min Bull Flag (multi-timeframe alignment) - very powerful setup.
- Consolidation at C should occur above 9 EMA.
- Do not enter at B (too risky, no stop). Enter close to C.`,
  },
  {
    id: 'abcd_entry',
    estrategia: 'ABCD',
    sesiones: ['open', 'late_morning'],
    tipo: 'entrada',
    text: `ABCD entry strategy:
- Enter at point C: as price holds support at C, enter close to C aiming for move toward D.
- C can be confirmed on 1-min chart. Use both 1-min and 5-min timeframes.
- Stop loss: loss of point C. If price drops below C, exit immediately.
- Buying close to C minimizes risk.
- Take partial profit at point D (sell half), then raise stop to entry price (break-even).
- Exit remaining shares when: target reached, OR stock losing steam, OR new low on 5-min chart.
- Some traders wait for entry at D for confirmation, but this reduces reward while increasing risk.`,
  },

  // ─── ORB ──────────────────────────────────────────────────────────────────
  {
    id: 'orb_strategy',
    estrategia: 'ORB',
    sesiones: ['open'],
    tipo: 'caracteristicas',
    text: `Opening Range Breakout (ORB) strategy:
- Wait at least 5 minutes (5-min ORB) after market open at 9:30am ET.
- The opening range = high and low of first 5-min candle(s).
- Opening range MUST be significantly smaller than the stock's ATR.
- Works best on mid to large cap stocks, not volatile low-float stocks.
- High volume with numerous different orders preferred (not just 10 large block orders).
- Works better on stocks with grinding/churning pattern and higher floats.`,
  },
  {
    id: 'orb_entry',
    estrategia: 'ORB',
    sesiones: ['open'],
    tipo: 'entrada',
    text: `ORB entry, stop, and targets:
- Entry: when stock breaks above opening range HIGH → go LONG. When breaks below opening range LOW → go SHORT.
- Stop for longs: close below VWAP. Stop for shorts: close above VWAP.
- Profit target: next important technical level (pre-market levels, daily moving averages, previous day close).
- If no clear technical level: exit if stock shows weakness when long (new 5-min low) or strength when short (new 5-min high).
- Stop can be low of last 5-min candle or arbitrary 5-10-20 cents.
- If not profitable immediately, bail out at breakeven. Breakout or bailout.`,
  },

  // ─── VWAP REVERSAL ────────────────────────────────────────────────────────
  {
    id: 'vwap_reversal_setup',
    estrategia: 'VWAP_REVERSAL',
    sesiones: ['open', 'late_morning'],
    tipo: 'caracteristicas',
    text: `VWAP Reversal strategy:
- Stocks in Play often reverse and test VWAP after initial directional move.
- Signal when BELOW VWAP: stock fails to make new 5-min low → sellers exhausted → potential squeeze back to VWAP.
- Signal when ABOVE VWAP: stock fails to make new 5-min high → buyers exhausted → potential drop to VWAP.
- Formation of Higher Highs and Higher Lows on 5-min while below VWAP = very bullish reversal signal.
- Short sellers covering when stock fails to continue down → price shoots up to VWAP.`,
  },
  {
    id: 'vwap_reversal_entry',
    estrategia: 'VWAP_REVERSAL',
    sesiones: ['open', 'late_morning'],
    tipo: 'entrada',
    text: `VWAP Reversal entry and management:
- Long entry: at failure to make new 5-min low (below VWAP), with stop below low of day or last 5-min candle.
- Short entry: at failure to make new 5-min high (above VWAP), with stop above high of day.
- Profit targets: 1) VWAP, 2) 9 EMA on 5-min, 3) 20 EMA on 5-min, 4) 50 SMA on 5-min.
- Take partial profit at VWAP, move stop to break-even, let rest run for possible VWAP Pop.
- If long below VWAP: sell part at VWAP, keep rest for squeeze above VWAP.
- Always ensure stop is at break-even once VWAP is reached (stock can bounce back from VWAP).
- Not all VWAP reversals are tradeable. Skip if no good entry or bad risk/reward.`,
  },

  // ─── VWAP FALSE BREAKOUT ──────────────────────────────────────────────────
  {
    id: 'vwap_false_breakout_setup',
    estrategia: 'VWAP_FALSE_BREAKOUT',
    sesiones: ['late_morning', 'midday'],
    tipo: 'caracteristicas',
    text: `VWAP False Breakout strategy:
- Usually occurs in late morning (after 10:30am) into early afternoon.
- A strong stock with institutional buying usually trades above VWAP.
- If big buyers finish orders or lose interest, stock falls back to VWAP.
- If it drops BELOW VWAP: sign of weakness → short sellers step in.
- If weak stock BELOW VWAP suddenly breaks ABOVE VWAP: short squeeze → go long.
- Stock that loses VWAP is like a buffalo losing strength - short sellers (wolves) wait for the right moment.`,
  },
  {
    id: 'vwap_false_breakout_entry',
    estrategia: 'VWAP_FALSE_BREAKOUT',
    sesiones: ['late_morning', 'midday'],
    tipo: 'entrada',
    text: `VWAP False Breakout entry:
- Short setup: stock had bounce ABOVE VWAP but fails to hold → loses VWAP again in late morning → go short.
- Stop loss: above VWAP.
- Can enter slightly before VWAP loss (ticks down toward VWAP) but use small size and add on confirmation.
- Profit targets: 1) new low of day, 2) next important technical support level.
- Long setup (short squeeze): stock below VWAP breaks above → shorts forced to cover → go long.
- Warning: job of trader is identification, not anticipation. If entering early, take small size.`,
  },

  // ─── VWAP MA TREND ────────────────────────────────────────────────────────
  {
    id: 'vwap_ma_trend',
    estrategia: 'VWAP_MA_TREND',
    sesiones: ['midday', 'close'],
    tipo: 'caracteristicas',
    text: `VWAP Moving Average Trend strategy (midday and close):
- Stocks in Play often find a trend after morning session: stay above VWAP moving higher, or below VWAP moving lower, using moving averages as guides.
- When 9 EMA or 20 EMA act as support (above VWAP): buy pullbacks to the moving average.
- When 9 EMA or 20 EMA act as resistance (below VWAP): short bounces to the moving average.
- Enter as close as possible to the moving average line (small stop = 5-10 cents below MA for longs).
- Ride the trend until break of 9 or 20 EMA. 20 EMA is stronger support/resistance.
- Does not require fast execution or hotkeys. Entry/exits can be manual.
- If stock moves very far from MA: take partial profit (1/4 or half position).`,
  },

  // ─── FALLEN ANGEL ─────────────────────────────────────────────────────────
  {
    id: 'fallen_angel_strategy',
    estrategia: 'FALLEN_ANGEL',
    sesiones: ['open'],
    tipo: 'caracteristicas',
    text: `Fallen Angel strategy:
1. Low-float Stock in Play gaps up with heavy pre-market volume (must have 1M+ shares traded pre-market).
2. At market open: stock makes new high of day then quickly sells off.
3. Do NOT enter yet. Wait for consolidation around key trading level (pre-market low, daily MAs, 5-min MAs).
4. Entry signal: new 1-min or 5-min high after consolidation WITH massive volume (significantly higher than previous candles).
5. Stop loss: below the consolidation period.
6. Profit targets: VWAP, current high of day, pre-market high, other nearby levels.
- Avoid first uptick at open - usually a trap followed by big sell-off.
- Best opportunity: stock sells off, finds support, comes back above VWAP and previous high of day.
- High difficulty strategy. Practice in simulator first. Use small size live.`,
  },

  // ─── RISK MANAGEMENT ─────────────────────────────────────────────────────
  {
    id: 'risk_management_rules',
    estrategia: 'RISK_MANAGEMENT',
    sesiones: ['all'],
    tipo: 'riesgo',
    text: `Risk Management Rules:
- The 2% Rule: Never risk more than 2% of account on single trade. New traders: 0.5%-1%.
- Position sizing formula: Max account risk ÷ per-share risk = shares allowed.
  Example: $200 max risk ÷ $0.10 stop = 2,000 shares max.
- The 6% Rule (Dr. Elder): Do not lose more than 6% of account in one month. If hit: stop live trading, switch to simulator.
- Risk/Reward minimum: Only take trades with ratio of 2:1 or better (aim for 3:1).
- Stop trading rules: 3 consecutive losing trades, gave back 50% of day profit, hit max daily loss, feeling frustrated or FOMO.
- Never average down (add to losing position) - this is account suicide.
- Never let a winning trade turn into a loss - take partial profits and move stop to break-even.`,
  },
  {
    id: 'trade_management',
    estrategia: 'RISK_MANAGEMENT',
    sesiones: ['all'],
    tipo: 'salida',
    text: `Trade management best practices:
- Take partial profits (1/2 or 1/4 of position) at first target.
- Move stop loss to break-even after first partial profit.
- Always move stop in direction of trade (trailing stop concept).
- Never lower stop loss to give trade more room - this is a critical error.
- If trade not working in first 5 minutes: bail out at break-even.
- When entry fails immediately: exit quickly, re-evaluate chart, re-enter if new setup forms.
- Accept small losses fast. Professional traders take several small attempts before catching big move.
- Sell on first red candle on 5-min chart (unless already up enough to hold through pullback).
- Scale into winners only, never into losers.`,
  },

  // ─── SESSIONS ─────────────────────────────────────────────────────────────
  {
    id: 'trading_sessions',
    estrategia: 'GENERAL',
    sesiones: ['all'],
    tipo: 'general',
    text: `Trading sessions and best strategies:
1. THE OPEN (9:30-10:30am ET): High volume, high volatility. Best strategies: Bull Flag, ORB, ABCD, VWAP Reversals, Fallen Angel.
2. LATE MORNING (10:30am-12pm ET): Market slows but Stocks in Play remain active. Easier for new traders. Best: VWAP Reversal, VWAP False Breakout. Bull Flag rarely effective here.
3. MIDDAY (12pm-3pm ET): Slowest part of day. Stocks in Play establish trends. Best: VWAP MA Trend, VWAP False Breakout. Wait to confirm if VWAP is held or lost.
4. THE CLOSE (3pm-4pm ET): Market becomes directional again. Best: VWAP MA Trend. Closing price reflects institutional sentiment.`,
  },

  // ─── LEVEL 2 ──────────────────────────────────────────────────────────────
  {
    id: 'level2_signals',
    estrategia: 'LEVEL2',
    sesiones: ['all'],
    tipo: 'general',
    text: `Level 2 (Market Depth) signals:
- Large Bid Order (big buyer on bid): often BEARISH. Buyer is waiting/passive → price can drop.
- Large Ask Order (big seller on ask): often BULLISH. Seller waiting → price can move higher.
- Aggressive buyers: buy at or above ask → signal urgency, covering shorts, strong buying pressure.
- Aggressive sellers: hit the bid repeatedly → strong selling pressure.
- Time & Sales: prints at/above ask = aggressive buying. Prints below bid = aggressive selling.
- NITF orders (No Intention To Fill): fake orders placed far from current price, quickly cancelled - market maker manipulation.
- Bullish Level 2: more size on BIDs than ASKs (imbalance), ASK side depleting when price approaches resistance.
- Always combine Level 2 with VWAP, daily chart, volume, and candlestick patterns. Never trade on L2 signal alone.`,
  },

  // ─── PSYCHOLOGY ───────────────────────────────────────────────────────────
  {
    id: 'psychology',
    estrategia: 'GENERAL',
    sesiones: ['all'],
    tipo: 'psicologia',
    text: `Trading psychology and discipline:
- FOMO (Fear of Missing Out): never chase a stock after missing a good entry. Bad entry is never worth it.
- Revenge trading: after a big loss, do NOT immediately trade something else to recover. This leads to more losses.
- A good trading day is one where you followed your rules, not just a green P&L day.
- Never turn a day trade into a swing trade by holding overnight.
- The hardest skill: cutting losses quickly instead of waiting for break-even.
- A trade is not a trade until you know your max loss AND potential profit target.
- "Live to play another day" - protect capital, limit losses, survive to trade tomorrow.
- You are both the problem and the solution in your trading career.`,
  },
];
