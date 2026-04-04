# Trading Strategies — Advanced Trading

Source: "Advanced Trading" book. All strategies tagged with `source: "Advanced Trading"` in the registry.

---

## Hard Stops (Pre-validation)

Before any strategy is evaluated, these conditions must ALL pass. If any fails, the stock is rejected:

| Condition | Threshold | Rationale |
|-----------|-----------|-----------|
| Change % | >= 5% | Not enough momentum |
| Relative Volume | >= 3x | Insufficient interest, dominated by algos |
| ATR | >= $0.30 | Price range too narrow for day trading |
| Session | Not AFTER_HOURS | No live trading |
| Price min | >= $1 | Penny stock risk |
| Price max | <= $50 | Outside small cap zone |
| VWAP | Must exist | Cannot assess directional bias |

---

## 1. BULL_FLAG

**Session**: THE_OPEN, LATE_MORNING

**Conditions to match**:
- `bullFlagDetected` = true (detector found pattern)
- `aboveVwap` = true (price > VWAP)

**Detector logic** (`bull-flag.detector.ts`):
- Looks in last 20 candles
- Finds a **pole**: 3+ candles, 70%+ green, close > open of first candle
- Finds a **flag**: 2+ candles, 50%+ red or doji (body < 30% of range)
- Flag high must NOT exceed pole high
- Retrace < 50% of pole range
- Checks volume: flag volume should be lower than pole volume

**Entry/Stop/Targets**:
| Level | Calculation |
|-------|-------------|
| Entry | price + $0.02 (breakout above flag) |
| Stop | min low of last 2 candles (flag low) |
| T1 | pre_market_high, or price + ATR*0.5 |
| T2 | price + ATR |

**What to watch**: Wait for first candle to make NEW HIGH after 2+ red consolidation candles. Volume must spike on breakout candle. Best on first or second consolidation.

---

## 2. FALLEN_ANGEL

**Session**: THE_OPEN only

**Conditions to match**:
- `fallenAngelDetected` = true

**Detector logic** (`fallen-angel.detector.ts`):
- HOD made in first 15 candles (~15 minutes)
- Sharp selloff after HOD: (HOD - selloff low) / HOD >= 5%
- Consolidation forming at end: last 3 candles have tight range (< 1.5x avg candle range)
- Optionally detects breakout starting (last candle > consolidation high)

**Entry/Stop/Targets**:
| Level | Calculation |
|-------|-------------|
| Entry | price + $0.02 |
| Stop | min low of last 3 candles (consolidation low) |
| T1 | VWAP |
| T2 | pre_market_high, or price + ATR |

**What to watch**: Stock made HOD at open, sold off hard, now consolidating. Enter on new 1-min high with massive volume. High difficulty — use small size.

---

## 3. ABCD

**Session**: THE_OPEN, LATE_MORNING

**Conditions to match**:
- `abcdDetected` = true
- `aboveVwap` = true
- `aboveEma9` = true

**Detector logic** (`abcd.detector.ts`):
- Looks in last 20 candles for swing points
- A = swing low, B = swing high (B > A), C = swing low (C > A, higher low)
- BC retrace < 80% of AB range
- D forming: candles after C trending up

**Entry/Stop/Targets**:
| Level | Calculation |
|-------|-------------|
| Entry | EMA9 (pullback to moving average) |
| Stop | EMA9 - ATR*0.25 |
| T1 | price + ATR*0.5 |
| T2 | pre_market_high, or price + ATR |

**What to watch**: Price holding at point C (higher low). Enter close to C as volume returns. A 1-min ABCD is typically a 5-min Bull Flag (multi-timeframe).

---

## 4. ORB (Opening Range Breakout)

**Session**: THE_OPEN only

**Conditions to match**:
- `orbDetected` = true

**Detector logic** (`orb.detector.ts`):
- Finds first candle at market open (9:30-9:34 ET)
- Defines opening range: candle high and low
- Range must be < ATR * 0.6 (tight range)
- Detects breakout: last candle close > range high (LONG) or < range low (SHORT)

**Entry/Stop/Targets**:
| Level | Calculation |
|-------|-------------|
| Entry | price + $0.02 |
| Stop | VWAP - ATR*0.1 |
| T1 | pre_market_high, or price + ATR*0.5 |
| T2 | price + ATR |

**What to watch**: Wait for stock to break above opening range HIGH (long) or below LOW (short) after first 5 minutes. Opening range should be small relative to ATR with high volume.

---

## 5. VWAP_REVERSAL

**Session**: THE_OPEN, LATE_MORNING

**Conditions to match**:
- `!aboveVwap` = true (price below VWAP)
- `vwapReversalDetected` = true

**Detector logic** (`vwap-reversal.detector.ts`):
- **Bullish reversal**: Last 5 candles below VWAP, last candle's low > prior candles' low (failed new low). Optionally detects HH/HL pattern forming (2+ higher highs and 2+ higher lows).
- **Bearish reversal**: Also detected but NOT matched by this strategy (only bullish).

**Entry/Stop/Targets**:
| Level | Calculation |
|-------|-------------|
| Entry | VWAP - ATR*0.1 (near VWAP) |
| Stop | price - ATR*0.3 (below current) |
| T1 | VWAP + ATR*0.3 |
| T2 | EMA9 + ATR*0.6 |

**What to watch**: Stock fails to make new 5-min low below VWAP, sellers exhausted. Look for HH/HL forming. Short covering visible. Not all VWAP reversals are tradeable — skip if bad R/R.

---

## 6. VWAP_FALSE_BREAKOUT

**Session**: LATE_MORNING, MIDDAY

**Conditions to match**:
- `!aboveVwap` = true (price recently lost VWAP)

**Concept**: Strong stock that loses VWAP in late morning = weakness signal. SHORT opportunity.

**Entry/Stop/Targets**:
| Level | Calculation |
|-------|-------------|
| Entry | price (current, below VWAP) |
| Stop | VWAP + ATR*0.15 (above VWAP) |
| T1 | price - ATR*0.4 |
| T2 | price - ATR*0.8 |

**What to watch**: Stock traded above VWAP then failed to hold. Drops back below with increasing sell volume. No aggressive buying on Level 2. Late morning timing (after 10:30am).

---

## 7. VWAP_LATE_MORNING

**Session**: LATE_MORNING only

**Conditions to match**:
- `aboveVwap` = true

**Entry/Stop/Targets**:
| Level | Calculation |
|-------|-------------|
| Entry | price (current) |
| Stop | min(VWAP - ATR*0.15, EMA9 - ATR*0.2) |
| T1 | price + ATR*0.5 |
| T2 | price + ATR |

---

## 8. VWAP_MA_TREND

**Session**: MIDDAY, THE_CLOSE

**Conditions to match**:
- `aboveVwap` = true
- `aboveEma20` = true

**Entry/Stop/Targets**:
| Level | Calculation |
|-------|-------------|
| Entry | EMA20 (pullback to moving average) |
| Stop | EMA20 - ATR*0.2 |
| T1 | price + ATR*0.4 |
| T2 | price + ATR*0.8 |

**What to watch**: Stock trending with 20 EMA as support above VWAP. Enter on pullback to MA. Multiple touches = stronger level. Does not require fast execution.

---

## 9. GENERAL (fallback)

**Session**: Any  
**Conditions**: Always matches (last in chain)

| Level | Calculation |
|-------|-------------|
| Entry | price |
| Stop | price - ATR*0.3 |
| T1 | price + ATR*0.5 |
| T2 | price + ATR |

---

## Strategy Priority Order

Evaluated in this order — first match wins:

1. BULL_FLAG
2. FALLEN_ANGEL
3. ABCD
4. ORB
5. VWAP_REVERSAL
6. VWAP_FALSE_BREAKOUT
7. VWAP_LATE_MORNING
8. VWAP_MA_TREND
9. GENERAL

---

## Session Definitions

| Session | Time (ET) | Minutes |
|---------|-----------|---------|
| PRE_MARKET | 4:00 - 9:30 | 240-570 |
| THE_OPEN | 9:30 - 11:00 | 570-660 |
| LATE_MORNING | 11:00 - 12:30 | 660-750 |
| MIDDAY | 12:30 - 14:00 | 750-840 |
| THE_CLOSE | 14:00 - 16:00 | 840-960 |
| AFTER_HOURS | 16:00 - 20:00 | 960-1200 |

---

## Key Chart Levels

| Level | Color | Style | Source |
|-------|-------|-------|--------|
| VWAP | Purple #a78bfa | Curve | Computed from candles |
| 9 EMA | Yellow #facc15 | Curve | Computed from closes |
| 20 EMA | Cyan #22d3ee | Curve | Computed from closes |
| Prev Close (PCL) | White | Large Dashed | gap_pct + first open |
| PM High | Magenta #f472b6 | Sparse Dotted | Max high where session=PRE_MARKET |
| PM Low | Lime #a3e635 | Sparse Dotted | Min low where session=PRE_MARKET |
