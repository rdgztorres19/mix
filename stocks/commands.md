# Trading ML — Command Reference

All commands run from the `stocks/` root directory unless noted otherwise.

---

## 1. Grid Search (Tree Models: XGBoost, LightGBM, CatBoost, RF, ExtraTrees)

### Full grid — ALL targets, ALL feature sets, ALL models
```bash
cd stock-training/ml && python -m experiments.run_grid
```

### MEGA GRID — ALL models × ALL features × ALL targets (con dataset actual con news)
```bash
cd stock-training/ml && python -m experiments.run_grid \
  --csv data/training-v2-morning-full-with-news.csv \
  --models XGBoost LightGBM CatBoost RandomForest ExtraTrees \
  --fsets A_base B_enriched C_price_action D_all D_clean D_clean_ext D1_core_momentum D2_breakout_structure D3_liquidity_context F_price_vol_time V2_core V2_full V2_momentum V2_full_bear bearish V3 V3_bear V3_tier1 V2_full_news D_clean_ext_news news_only V4_orderflow V4_orderflow_lean V4_orderflow_only \
  --targets bin_fr5m_1p0 bin_fr5m_1p5 bin_fr5m_2p0 bin_fr5m_2p5 bin_mfr10m_1p0 bin_mfr10m_1p5 bin_mfr10m_2p0 bin_mfr10m_2p5 bin_mfr10m_1atr bin_mfr10m_1p5atr bin_break_hod bin_breakdown_lod_10m bin_first_touch_10m_1p0 bin_first_touch_10m_1p5 bin_first_touch_10m_2p0 bin_first_touch_10m_2p5 bin_tb5m_tp2p0_sl1p0 bin_tb10m_tp1p5_sl0p5 bin_tb10m_tp2p0_sl0p7 bin_tb10m_tp2p5_sl1p0 bin_tb10m_tp4p0_sl2p0 bin_tb10m_tp5p0_sl2p5 bin_tb10m_tp6p0_sl3p0 bin_tb15m_tp3p0_sl1p5 bin_tb30m_tp3p0_sl1p5 bin_tb30m_tp4p0_sl2p0 bin_tb60m_tp4p0_sl2p0 bin_fr10m_1p0 bin_fr10m_1p5 bin_mae10m_lt_0p5 bin_mae10m_lt_1p0 bin_opportunity_clean_10m_1p5_0p5 bin_opportunity_clean_10m_1p0_0p3 bin_rr5m_ge_2 bin_rr10m_ge_2 bin_rr10m_ge_3 bin_rr30m_ge_2 bin_follow_through_hod_10m_0p5 bin_follow_through_hod_10m_1p0 bin_sustained_momentum_10m bin_clean_entry_10m bin_clean_entry_30m bin_morning_breakout_5m bin_clean_morning_15m bin_drop_2p0_10m bin_drop_4p0_10m bin_drop_2p0_30m bin_drop_4p0_30m bin_sl_before_tp_10m bin_sl_before_tp_30m bin_rr10m_bearish_ge_2 bin_fr10m_neg_1p0 bin_fr10m_neg_2p0 bin_clean_short_10m bin_vol_exp_5m_2atr bin_vol_exp_10m_2atr bin_vol_exp_10m_3atr bin_vol_exp_10m_5atr bin_vol_exp_10m_8atr bin_vol_exp_10m_3pct bin_vol_exp_10m_5pct bin_vol_exp_10m_8pct bin_vol_exp_10m_10pct bin_vol_exp_30m_3atr bin_vol_exp_30m_5atr bin_vol_exp_30m_8atr bin_vol_exp_30m_5pct bin_vol_exp_30m_8pct bin_vol_exp_30m_10pct bin_vol_exp_30m_15pct bin_vol_rr_10m
```
> **5 modelos × 24 fsets × 69 targets = 8,280 combinaciones.** Toma MUCHO tiempo. Considerar correr por partes.

### SMART GRID — mejores targets probados + todos los features (recomendado)
```bash
cd stock-training/ml && python -m experiments.run_grid \
  --csv data/training-v2-morning-full-with-news.csv \
  --models XGBoost LightGBM CatBoost RandomForest ExtraTrees \
  --fsets A_base B_enriched C_price_action D_all D_clean D_clean_ext D1_core_momentum D2_breakout_structure D3_liquidity_context F_price_vol_time V2_core V2_full V2_momentum V2_full_bear bearish V3 V3_bear V3_tier1 V2_full_news D_clean_ext_news news_only V4_orderflow V4_orderflow_lean V4_orderflow_only \
  --targets bin_drop_4p0_30m bin_sl_before_tp_10m bin_sl_before_tp_30m bin_vol_exp_10m_2atr bin_vol_exp_10m_3atr bin_vol_exp_10m_3pct bin_rr10m_ge_2 bin_tb30m_tp4p0_sl2p0 bin_tb30m_tp3p0_sl1p5 bin_drop_2p0_30m bin_rr10m_bearish_ge_2 bin_clean_short_10m bin_vol_rr_10m
```
> **5 modelos × 24 fsets × 13 targets = 1,560 combinaciones.** Targets con mejores resultados CPCV:
> - `bin_drop_4p0_30m` — short 39.2% WR (CPCV P@0.70=0.834) **MEJOR**
> - `bin_sl_before_tp_10m/30m` — SL antes que TP (CPCV P@0.70=0.916) **MEJOR**
> - `bin_vol_exp_10m_2atr/3atr/3pct` — vol expansion 85%+ (CPCV validado)
> - `bin_rr10m_ge_2` — risk/reward >= 2 (mejor direction target)
> - `bin_tb30m_tp4p0_sl2p0/tp3p0_sl1p5` — triple barrier clásicos
> - `bin_drop_2p0_30m`, `bin_rr10m_bearish_ge_2`, `bin_clean_short_10m` — otros bearish
> - `bin_vol_rr_10m` — combinado vol + R/R

### Filtered grid — specific models, feature sets, targets
```bash
cd stock-training/ml && python -m experiments.run_grid \
  --models XGBoost LightGBM \
  --fsets V2_full V2_core D_clean D_clean_ext V4_orderflow V2_full_news \
  --targets bin_tb30m_tp4p0_sl2p0 bin_rr10m_ge_2 bin_drop_4p0_30m bin_vol_exp_10m_2atr
```

### Quick grid (subset: 3 models × 4 fsets × 5 targets)
```bash
cd stock-training/ml && python -m experiments.run_grid --quick
```

### Grid with custom CSV (e.g. with news features)
```bash
cd stock-training/ml && python -m experiments.run_grid \
  --csv data/training-v2-morning-full.csv \
  --models XGBoost LightGBM \
  --fsets V2_full_news D_clean_ext_news news_only \
  --targets bin_rr10m_ge_2 bin_drop_4p0_30m bin_vol_exp_10m_2atr
```

### Available models
`XGBoost`, `LightGBM`, `CatBoost`, `RandomForest`, `ExtraTrees`, `LogisticRegression`

### Available feature sets
| Name | Description |
|------|-------------|
| A_base | Original base |
| B_enriched | Enhanced |
| D_clean | Cleaned all features |
| D_clean_ext | Extended cleaned |
| V2_core | Core relative features |
| V2_full | Full relative features |
| V2_momentum | Momentum relative |
| V2_full_bear | Bearish relative |
| bearish | Bearish indicators |
| V3, V3_bear, V3_tier1 | V3 sets |
| V2_full_news | V2_full + 10 news features |
| D_clean_ext_news | D_clean_ext + 10 news |
| news_only | 10 news features only |
| V4_orderflow | V2_full + VPIN |
| V4_orderflow_lean | V2_core + VPIN |
| V4_orderflow_only | VPIN only |

### Available targets

**Direction (triple barrier):**
`bin_tb5m_tp2p0_sl1p0`, `bin_tb10m_tp2p0_sl0p7`, `bin_tb10m_tp2p5_sl1p0`, `bin_tb10m_tp4p0_sl2p0`, `bin_tb15m_tp3p0_sl1p5`, `bin_tb30m_tp3p0_sl1p5`, `bin_tb30m_tp4p0_sl2p0`, `bin_tb60m_tp4p0_sl2p0`

**Risk/Reward:**
`bin_rr5m_ge_2`, `bin_rr10m_ge_2`, `bin_rr10m_ge_3`, `bin_rr30m_ge_2`

**Bearish (shorts):**
`bin_drop_2p0_10m`, `bin_drop_2p0_30m`, `bin_drop_4p0_10m`, `bin_drop_4p0_30m`, `bin_sl_before_tp_10m`, `bin_sl_before_tp_30m`, `bin_fr10m_neg_1p0`, `bin_fr10m_neg_2p0`, `bin_clean_short_10m`

**Volatility expansion:**
`bin_vol_exp_5m_2atr`, `bin_vol_exp_10m_2atr`, `bin_vol_exp_10m_3atr`, `bin_vol_exp_10m_5atr`, `bin_vol_exp_10m_3pct`, `bin_vol_exp_10m_5pct`, `bin_vol_exp_30m_3atr`, `bin_vol_exp_30m_5atr`, `bin_vol_exp_30m_5pct`, `bin_vol_exp_30m_15pct`

**Combined:**
`bin_vol_rr_10m`

---

## 2. Grid Search (LSTM / CNN-LSTM Sequence Models)

### Full sequence grid
```bash
cd stock-training/ml && python -m experiments.run_sequence_grid
```

### MEGA SEQUENCE GRID — ALL LSTM models × ALL features × ALL targets (con dataset actual)
```bash
cd stock-training/ml && python -m experiments.run_sequence_grid \
  --csv data/training-v2-morning-full-with-news.csv \
  --models lstm lstm_attention cnn_lstm gru transformer \
  --feature-sets full_30 lean_12 momentum_15 vol_volume_12 structure_14 oscillators_10 raw_8 raw_12 lean_news_22 news_only_10 \
  --targets bin_tb30m_tp4p0_sl2p0 bin_tb30m_tp3p0_sl1p5 bin_tb15m_tp3p0_sl1p5 bin_tb10m_tp2p0_sl0p7 bin_tb10m_tp2p5_sl1p0 bin_tb5m_tp2p0_sl1p0 \
  --epochs 30 --patience 7 --batch-size 128
```
> **5 modelos × 10 fsets × 6 targets = 300 combinaciones.** Cada una entrena ~5-10 min.

### Filtered sequence grid
```bash
cd stock-training/ml && python -m experiments.run_sequence_grid \
  --models cnn_lstm lstm_attention \
  --feature-sets full_30 lean_12 momentum_15 \
  --targets bin_tb30m_tp4p0_sl2p0 bin_rr10m_ge_2 bin_drop_4p0_30m
```

### Quick sequence grid
```bash
cd stock-training/ml && python -m experiments.run_sequence_grid --quick
```

### With custom CSV
```bash
cd stock-training/ml && python -m experiments.run_sequence_grid \
  --csv data/training-v2-morning-full.csv \
  --models cnn_lstm \
  --feature-sets full_30 lean_news_22 \
  --targets bin_tb30m_tp4p0_sl2p0 bin_drop_4p0_30m
```

### Available sequence models
`lstm`, `lstm_attention`, `cnn_lstm`, `gru`, `transformer`

### Available sequence feature sets
`full_30`, `lean_12`, `momentum_15`, `vol_volume_12`, `structure_14`, `oscillators_10`, `raw_8`, `raw_12`, `lean_news_22`, `news_only_10`

---

## 3. CPCV Validation (Statistical Rigor Check)

Validates if grid results are genuine or false discoveries. Uses Combinatorial Purged Cross-Validation + Platt calibration + Deflated Sharpe Ratio.

### Full validation (45 paths, slow but thorough)
```bash
cd stock-training/ml && python -m experiments.run_cpcv_validation
```

### Quick validation (10 paths, faster)
```bash
cd stock-training/ml && python -m experiments.run_cpcv_validation --quick
```

### With custom CSV
```bash
cd stock-training/ml && python -m experiments.run_cpcv_validation --csv data/training-v2-morning-full.csv --quick
```

> **Note:** Edit the `TOP_COMBOS` list in `run_cpcv_validation.py` to validate different model/fset/target combinations. Current list:
> - LightGBM/V4_orderflow/bin_rr10m_ge_2
> - XGBoost/V2_full/bin_rr10m_ge_2
> - XGBoost/V2_full/bin_vol_exp_10m_2atr
> - etc.

---

## 4. Train Best Models

### Train from grid defaults (no hyperparameter tuning)
```bash
cd stock-training/ml && python -m experiments.train_best --from-grid
```

### Train specific rank from tuned params
```bash
cd stock-training/ml && python -m experiments.train_best --rank 1
```

### Train all tuned configs
```bash
cd stock-training/ml && python -m experiments.train_best --all
```

### Train with custom CSV
```bash
cd stock-training/ml && python -m experiments.train_best --from-grid --csv data/training-v2-morning-full.csv
```

### Train single LSTM/CNN-LSTM model
```bash
cd stock-training/ml && python -m experiments.train_sequence \
  --model cnn_lstm \
  --target bin_tb30m_tp4p0_sl2p0 \
  --epochs 100 \
  --patience 15
```

### Train with custom CSV + specific hyperparams
```bash
cd stock-training/ml && python -m experiments.train_sequence \
  --model cnn_lstm \
  --target bin_drop_4p0_30m \
  --csv data/training-v2-morning-full.csv \
  --epochs 50 \
  --batch-size 32 \
  --lr 0.001 \
  --seq-len 60
```

> **Note:** Edit `GRID_TOP_CONFIGS` in `train_best.py` to change which models get trained with `--from-grid`.

---

## 5. Backtest Simulator

### Long backtest (single day)
```bash
cd trading-agent && npx ts-node src/scripts/backtest-simulator/main.ts \
  <DATE> <START_TIME> <END_TIME> <THRESHOLD> <TP%> <SL%>
```

**Example:**
```bash
cd trading-agent && npx ts-node src/scripts/backtest-simulator/main.ts \
  2026-03-25 09:30 11:00 0.65 4 2
```

### Short backtest (single day)
```bash
cd trading-agent && npx ts-node src/scripts/backtest-simulator/main-short.ts \
  <DATE> <START_TIME> <END_TIME> <THRESHOLD> <TP%> <SL%>
```

**Example — with specific model:**
```bash
cd trading-agent && PREDICT_MODEL=XGBoost_D_clean_bin_drop_4p0_30m \
  npx ts-node src/scripts/backtest-simulator/main-short.ts \
  2026-03-25 09:30 11:00 0.70 4 2
```

### Dual model backtest (vol_exp + direction)
```bash
cd trading-agent && \
  DUAL_VOL_MODEL=XGBoost_V2_full_bin_vol_exp_10m_2atr \
  DUAL_RR_MODEL=XGBoost_V2_full_bin_rr10m_ge_2 \
  DUAL_VOL_THRESHOLD=0.80 \
  DUAL_RR_THRESHOLD=0.60 \
  npx ts-node src/scripts/backtest-simulator/main-dual.ts \
  2026-03-25 09:30 11:00
```

### Multi-day backtest range (long, uses --lgbm for tree models)
```bash
cd trading-agent && ./backtest_range.sh \
  <START_DATE> <END_DATE> <START_TIME> <END_TIME> <THRESHOLD> <TP%> <SL%> --lgbm
```

**Example:**
```bash
cd trading-agent && ./backtest_range.sh \
  2026-03-17 2026-03-27 09:30 11:00 0.70 4 2 --lgbm
```

### Multi-day backtest range (LSTM/CNN-LSTM)
```bash
cd trading-agent && ./backtest_range.sh \
  2026-03-17 2026-03-27 09:30 11:00 0.70 4 2 lstm cnn_lstm
```

### Backtest env vars (optional)
| Variable | Default | Description |
|----------|---------|-------------|
| `PREDICT_MODEL` | auto | Model directory name (e.g. `XGBoost_D_clean_bin_drop_4p0_30m`) |
| `PREDICT_BATCH_SCRIPT` | auto | Python script name |
| `SCREENER_TOP_N` | 40 | Top N screener results |
| `MIN_DAILY_VOL` | 250000 | Min volume filter |
| `LOOK_AHEAD` | 120 | Look-ahead bars |
| `PAYLOAD_WINDOW` | 30 | Payload window (min) |

---

## 6. Scanner (ver stocks del día)

### Scanner a una hora específica
```bash
cd trading-agent && npx ts-node src/scripts/backtest-simulator/scanner.ts <DATE> [TIME]
```

**Ejemplos:**
```bash
cd trading-agent && npx ts-node src/scripts/backtest-simulator/scanner.ts 2026-03-25
cd trading-agent && npx ts-node src/scripts/backtest-simulator/scanner.ts 2026-03-25 09:45
cd trading-agent && npx ts-node src/scripts/backtest-simulator/scanner.ts 2026-03-25 10:00 --top 50
cd trading-agent && npx ts-node src/scripts/backtest-simulator/scanner.ts 2026-03-25 09:35 --min-vol 500000
```

### Scanner EOD (día completo, sin hora)
```bash
cd trading-agent && npx ts-node src/scripts/backtest-simulator/scanner-eod.ts <DATE> [--sort gap|change|range|volume] [--order asc|desc] [--top N] [--min-vol N]
```

**Ejemplos:**
```bash
cd trading-agent && npx ts-node src/scripts/backtest-simulator/scanner-eod.ts 2026-03-27
cd trading-agent && npx ts-node src/scripts/backtest-simulator/scanner-eod.ts 2026-03-27 --sort gap
cd trading-agent && npx ts-node src/scripts/backtest-simulator/scanner-eod.ts 2026-03-27 --sort change --order asc
cd trading-agent && npx ts-node src/scripts/backtest-simulator/scanner-eod.ts 2026-03-27 --sort range --top 50
cd trading-agent && npx ts-node src/scripts/backtest-simulator/scanner-eod.ts 2026-03-27 --sort volume --min-vol 500000
```

> Usa datos locales de `data/{date}/`. Muestra OHLC, gap%, change%, range%, volumen y rankings. Default ordena por screener rank, `--order` default es `desc`.

---

## 7. News-Reaction Backtest

### Historical backtest on news data
```bash
cd trading-agent && npx ts-node src/scripts/news-trader/backtest.ts \
  <START_DATE> <END_DATE> [--tp <TP%>] [--sl <SL%>]
```

**Examples:**
```bash
cd trading-agent && npx ts-node src/scripts/news-trader/backtest.ts 2026-03-20 2026-03-27
cd trading-agent && npx ts-node src/scripts/news-trader/backtest.ts 2026-03-20 2026-03-27 --tp 5 --sl 2
```

### Live/Paper news trader
```bash
cd trading-agent && npx ts-node src/scripts/news-trader/main.ts --dry-run
cd trading-agent && npx ts-node src/scripts/news-trader/main.ts --size 500 --max-positions 3
```

---

## 8. Data Pipeline

### Download historical news from Alpaca
```bash
cd stock-training && npx ts-node scripts/download-news.ts <START_DATE> <END_DATE>
```

### Enrich CSV with news features
```bash
cd stock-training && npx ts-node scripts/add-news-features.ts \
  ml/data/training-v2-morning.csv \
  ml/data/training-v2-morning-full.csv
```

---

## Quick Reference — Proven Results

| Strategy | Model | Target | Threshold | TP/SL | WR | Status |
|----------|-------|--------|-----------|-------|-----|--------|
| **Short** | XGBoost_D_clean | bin_drop_4p0_30m | 0.80 | 4%/2% | 39.2% | CPCV validated |
| **Short** | XGBoost | bin_sl_before_tp_10m | 0.70 | varies | — | CPCV validated (P@0.70=0.916) |
| **Vol exp** | XGBoost_V2_full | bin_vol_exp_10m_2atr | 0.70 | — | 85%+ | CPCV validated (direction unknown) |
| Direction | Any | bin_tb*/bin_rr* | any | any | ~33% | CPCV: all false discoveries |

> Break-even WR for 2:1 (TP=4%, SL=2%) = 33.3%. Anything above is profitable.
