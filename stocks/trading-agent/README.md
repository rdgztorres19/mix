# Trading RAG Agent

AI-powered day trading assistant using LangChain, RAG (Qdrant), momoscreener.com, and NestJS.

## Architecture

```
User → POST /agent/analyze → LangChain Agent
                               ├── Tool: get_stock_data          → momoscreener.com API
                               ├── Tool: analyze_news_catalyst   → Yahoo Finance / momoscreener news
                               ├── Tool: apply_trading_rules     → Deterministic rules engine
                               ├── Tool: search_trading_knowledge → Qdrant RAG
                               └── Tool: run_python              → Ejecuta código Python (pandas, numpy, matplotlib)

UI (React + Vite) → http://localhost:5173
  ├── Ticker input + search
  ├── Candlestick charts (1m / 5m) with VWAP, EMA9, EMA20
  └── Agent analysis panel (decision, entry/stop/targets, R:R, justification)
```

node scripts/debug-predict.js AIFF 2026-03-04 9:30 16:00 0.7

## Fast vs Agentic — Cuándo usar cada modo

| Si… | Usa | Tiempo típico |
|-----|-----|---------------|
| **Operas en vivo** — necesitas decisión rápida | **Fast** ⚡ | ~2–15 s |
| **Rechazos** — hard stops, catalyst débil, dilutivo | **Fast** (early exit sin LLM) | ~2 s |
| **Quieres explorar** — razonamiento flexible, múltiples consultas RAG | **Agentic** | ~20–40 s |
| **Investigación / backtesting manual** — no importa la latencia | **Agentic** | ~20–40 s |

```
                    ¿Necesitas respuesta en segundos?
                              │
                    ┌─────────┴─────────┐
                    │                   │
                   SÍ                   NO
                    │                   │
                    ▼                   ▼
              ┌──────────┐        ┌──────────┐
              │   FAST   │        │ AGENTIC  │
              │    ⚡    │        │  🔄      │
              └──────────┘        └──────────┘
                    │                   │
    Pipeline fijo:                    LLM decide
    • fetch stock+news                qué tools llamar
    • rules determinísticos          y en qué orden
    • early exit si falla
    • 1 LLM call si califica
```

**En el UI:** toggle `⚡ Fast` / `Agentic` en el header. Fast viene activado por defecto.

**En la API:** `fast: true` en el body del POST para usar Fast.

## Quick Start

### 1. Configure environment
```bash
cp .env.example .env
# Fill in your OPENAI_API_KEY (no other keys needed — momoscreener is public)
```

### 2. Start Qdrant
```bash
docker compose up -d
```

### 3. (Opcional) Python sandbox para run_python tool
```bash
cd scripts/python-sandbox
pip3 install -r requirements.txt
```
Requiere: pandas, numpy, matplotlib. Si no lo instalas, el tool run_python fallará si el agente lo usa.

### 4. Embed your trading knowledge
```bash
npm run embed
```

### 5. Start the API
```bash
npm run start:dev
# → http://localhost:3100
```

### 6. Start the UI
```bash
cd ui
npm install   # solo la primera vez
npm run dev
# → http://localhost:5173
```

## API Endpoints

### Analyze a stock
```bash
POST /agent/analyze
{
  "ticker": "NVDA",
  "account_size": 25000,
  "timeframe": "5m",      // opcional: "1m" | "5m" — velas para VWAP/EMA/ATR (default: 5m)
  "fast": true,           // opcional: true = pipeline rápido (~2–15s), false = agentic (~20–40s). Default en UI: true
  "cutoff_ms": 1738600000000  // opcional: unix ms para modo replay/simulación
}
```

**Response:**
```json
{
  "ticker": "NVDA",
  "decision": "PREPARAR_ENTRADA",
  "momento_analisis_et": "3/1/2026, 2:30 PM ET",
  "estrategia": "Bull Flag",
  "estrategia_mas_probable": "Bull Flag formando",
  "esperar_para_validar": "Break del high de consolidación con volumen",
  "entry": 18.55,
  "stop": 18.15,
  "target_1": 18.75,
  "target_2": 19.10,
  "share_size": 250,
  "riesgo_total": 100,
  "ratio_rr": 2.4,
  "sesion": "THE_OPEN",
  "justificacion": "...",
  "alertas": ["..."],
  "rag_chunks_usados": 3,
  "tool_calls_made": 5,
  "raw_analysis": "..."
}
```

### Get daily watchlist
```bash
GET /scanner/watchlist
```

### Get stock snapshot
```bash
GET /scanner/snapshot/NVDA
```

### Predict — ¿Se puede operar? (ML)

El endpoint `/predict` invoca un modelo LightGBM (binario: ¿sube ≥1.5% en 10 min?) entrenado con ~1M velas de 1 minuto.

#### Flujo completo NestJS → Python

```
NestJS (predictor.service.ts)
  │
  ├─ 1. Fetch ALL candles from MySQL (training_1m) for ticker+date
  │     SELECT * FROM training_1m WHERE symbol=? AND date=? ORDER BY candle_idx ASC
  │
  ├─ 2. Build payload JSON with raw OHLCV + metadata
  │
  └─ 3. Spawn: python3 predict.py  (stdin=JSON, stdout=JSON)
         │
         ├─ build_dataframe()  →  DataFrame base (~23 columnas)
         ├─ add_features()     →  +56 features engineered (RSI, momentum, etc.)
         ├─ scaler.transform() →  StandardScaler (normaliza 79 features)
         └─ model.predict_proba() → probabilidad clase +1 (long)
```

#### Lo que NestJS envía a Python (payload JSON)

**Todas las velas del día** hasta la vela objetivo, más metadata:

```jsonc
{
  // ── Velas (TODAS las del día hasta target) ──
  "candles": [
    { "t": 0, "o": 5.20, "h": 5.50, "l": 5.10, "c": 5.40, "v": 150000 },
    { "t": 1, "o": 5.40, "h": 5.55, "l": 5.35, "c": 5.45, "v": 120000 },
    // ... cada vela de 1 minuto desde premarket hasta la vela actual
  ],
  "target_idx": 45,                // índice de la vela a predecir (dentro del array)

  // ── Arrays de MySQL (para features de tiempo e índice correctos) ──
  "candle_times_et": ["06:07", "06:15", ..., "09:45"],  // hora ET de cada vela
  "candle_idx_arr": [3, 4, 5, ..., 48],                 // candle_idx original de MySQL

  // ── Metadata (valores escalares del row target en MySQL) ──
  "atr": 0.15,                     // Average True Range
  "high_of_day": 5.80,             // High of Day hasta ese momento
  "low_of_day": 5.00,              // Low of Day hasta ese momento
  "pre_market_high": 5.60,         // High del premarket
  "change_pct_at_candle": 0.025,   // Cambio % desde prev close (fracción, no %)
  "shares_outstanding": 50000000,  // Acciones en circulación
  "market_cap": 270000000,         // Market cap en USD
  "gap_pct": 0.05,                 // Gap % de apertura (fracción)
  "premarket_volume": 500000,      // Volumen total premarket

  // ── Config ──
  "_threshold": 0.6                // Umbral de probabilidad para señal
}
```

#### Lo que Python calcula internamente

Python recibe los datos crudos y computa **todos** los features en dos etapas:

**Etapa 1 — `build_dataframe()`** (columnas base desde OHLCV):

| Columna | Cómo se calcula |
|---------|-----------------|
| `ema9`, `ema20` | EMA exponencial sobre closes |
| `vwap` | VWAP acumulado: Σ(TP×vol) / Σ(vol) |
| `change_1m` | (close - close[-1]) / close[-1] |
| `change_5m` | (close - close[-5]) / close[-5] |
| `change_10m` | (close - close[-10]) / close[-10] |
| `momentum_acumulado` | (close - close[0]) / close[0] |
| `minutes_since_hod` | candle_idx actual - candle_idx del HOD |

**Etapa 2 — `add_features()`** (56 features engineered):

| Categoría | Features | Descripción |
|-----------|----------|-------------|
| **Volumen** | `volume_rel` | vol / rolling_mean(vol, 20) |
| | `volume_spike` | volume_rel > 3.0 |
| | `volume_acceleration` | volume_rel - volume_rel[-1] |
| | `cumulative_volume_ratio` | cumsum(vol) / estimated_daily_vol |
| | `relative_dollar_volume` | (close×vol) / rolling_mean(close×vol, 20) |
| | `dollar_volume` | close × volume |
| | `float_rotation` | cumsum(vol) / shares_outstanding |
| **Momentum** | `rsi` | RSI(14) |
| | `mom_5`, `mom_10` | close - close[-5], close - close[-10] |
| | `roc_3/5/10/20` | Rate of Change a 3,5,10,20 períodos |
| | `momentum_acceleration` | mom_5 - mom_5[-1] |
| | `momentum_divergence` | z(price_mom) - z(vol_mom) |
| **Volatilidad** | `volatility_15m` | rolling_std(returns, 15) |
| | `volatility_ratio` | volatility_15m / rolling_mean(volatility_15m, 30) |
| | `consolidation_score` | 1 - (range_5bars / range_20bars) |
| | `bar_range_vs_atr` | (high-low) / atr |
| **Distancias** | `dist_vwap_pct` | (close - vwap) / vwap |
| | `dist_hod_pct` | (close - high_of_day) / high_of_day |
| | `dist_lod_pct` | (close - low_of_day) / low_of_day |
| | `dist_pm_high` | (close - pre_market_high) / pre_market_high |
| | `dist_ema9`, `dist_ema20` | (close - ema) / ema |
| | `dist_gap` | distancia al gap |
| | `dist_to_round_number` | distancia al número redondo más cercano |
| **Breakouts** | `break_hod` | 1 si close > high_of_day anterior |
| | `break_pm_high` | 1 si close > pre_market_high |
| | `range_expansion` | 1 si rango actual > rango previo × 1.5 |
| | `vwap_cross_up` | 1 si cruzó VWAP hacia arriba |
| | `gap_filled` | 1 si el gap fue llenado |
| **Price Action** | `body_pct` | \|close-open\| / (high-low) |
| | `upper_wick_pct` | upper_wick / (high-low) |
| | `lower_wick_pct` | lower_wick / (high-low) |
| | `is_green` | 1 si close > open |
| | `consecutive_green/red` | velas verdes/rojas consecutivas |
| | `pct_of_day_range` | (close-low_of_day) / day_range |
| | `relative_range` | (high-low) / rolling_mean(range, 20) |
| | `spread_estimate` | estimación del spread |
| **Volumen avanzado** | `obv_slope_5` | pendiente del OBV (5 períodos) |
| | `volume_price_trend` | VPT acumulado |
| **Returns** | `return_lag_1/2/3` | returns retrasados 1, 2, 3 períodos |
| | `atr_rel` | atr / close |
| **Tiempo** | `minute_of_day` | minuto del día (ej: 570 = 9:30) |
| | `time_since_open_min` | minutos desde market open |
| | `is_premarket` | 1 si antes de 9:30 |
| | `is_open` | 1 si 9:30-9:35 |
| | `is_first_30min` | 1 si 9:30-10:00 |
| | `is_midday` | 1 si 12:00-15:00 |
| | `is_power_hour` | 1 si 15:00-16:00 |
| | `is_last_hour` | 1 si 15:00-16:00 |

**Total: 79 features** → StandardScaler → LightGBM predict_proba

#### Modelo

| Propiedad | Valor |
|-----------|-------|
| Algoritmo | LightGBM (binary) |
| Feature set | D_all (79 features) |
| Target | bin_mfr10m_1p5 (max_future_return_10m ≥ 1.5%) |
| Clases | 0 (no sube ≥1.5%), 1 (sí sube ≥1.5%) |
| Threshold | 0.6 (prob clase 1 para señal long) |
| Scaler | StandardScaler |
| Archivos | `stock-training/ml/experiments/results/best_model/` — model.joblib, scaler.joblib, meta.json |

#### Respuesta de Python

```json
{
  "tradeable": true,
  "prob": 0.7234,
  "threshold": 0.6
}
```

- `prob`: probabilidad de que la acción suba ≥1.5% en los próximos 10 minutos
- `tradeable`: `prob >= threshold`

#### API

```bash
# Modo histórico (NestJS busca velas en MySQL automáticamente)
POST /predict?threshold=0.6
{
  "ticker": "ASNS",
  "date": "2025-09-02",
  "candle_time_et": "09:45"
}

# Modo live (enviar velas directamente)
POST /predict?threshold=0.6
{
  "candles": [{"t": 1741267800, "o": 5.2, "h": 5.5, "l": 5.1, "c": 5.4, "v": 150000}, ...],
  "target_idx": 45,
  "atr": 0.15,
  "high_of_day": 5.8,
  "low_of_day": 5.0,
  "pre_market_high": 5.6,
  "shares_outstanding": 50000000,
  "market_cap": 270000000,
  "gap_pct": 0.05,
  "premarket_volume": 500000
}
```

Requiere que `stock-training` esté en `../stock-training` (o `STOCK_TRAINING_PATH` en `.env`).

## Agent Tool Loop

The agent follows this flow for each analysis:
1. `get_stock_data(ticker)` → price, VWAP, EMAs, volume, HOD/LOD, 1m & 5m candles (momoscreener)
2. `analyze_news_catalyst(ticker)` → fetches headlines, classifies catalyst strength (STRONG/MODERATE/WEAK/NONE)
3. `apply_trading_rules(...)` → identifies strategy, entry/stop/targets, R/R
4. `search_trading_knowledge(query, strategy)` → retrieves specific strategy rules from RAG
5. (optional) `search_trading_knowledge(...)` → retrieves risk/exit rules
6. (optional) `run_python(code)` → ejecuta Python con pandas, numpy, matplotlib cuando necesita cálculos o gráficos
7. Final response with structured JSON decision

> If catalyst is NONE or WEAK → `NO_OPERAR`.
> If dilutive event detected (offering/secondary) → `NO_OPERAR` on long side.
> If catalyst is STRONG → high-conviction "Stock in Play" setup allowed.

## UI

React app at `ui/` — dark terminal-style interface:

| Element | Description |
|---------|-------------|
| Ticker input | Type symbol + Enter or click Buscar |
| Stats bar | Price, change %, HOD, LOD, VWAP, EMA9, EMA20, ATR, Rel Vol, PM High |
| 1m chart | 1-minute candlesticks with volume, VWAP, EMA9/20 overlay |
| 5m chart | 5-minute aggregated candlesticks with same overlays |
| 🤖 Analizar | Sends to agent → shows decision, entry/stop/targets, R:R, justification |

## Trading Sessions

| Session | Time (ET) | Best Strategies |
|---------|-----------|-----------------|
| THE_OPEN | 9:30–10:30am | Bull Flag, ABCD, ORB, Fallen Angel |
| LATE_MORNING | 10:30am–12pm | VWAP Reversal, VWAP False Breakout |
| MIDDAY | 12pm–3pm | VWAP MA Trend, VWAP False Breakout |
| THE_CLOSE | 3pm–4pm | VWAP MA Trend |

## Stock Selection Filters (from knowledge.txt)

- Price: $2–$20
- Change today: +10% minimum
- Relative volume: 5x minimum
- Float: ≤ 20M shares
- ATR: ≥ $0.50

## Python Tool (run_python)

El agente puede ejecutar código Python cuando necesita cálculos complejos o visualizaciones. Librerías pre-cargadas:
- `pd` (pandas)
- `np` (numpy)
- `plt` (matplotlib.pyplot, backend Agg)

**Instalación:** `pip3 install -r scripts/python-sandbox/requirements.txt`

## Risk Management (enforced by rules engine)

- Max 2% account risk per trade
- Minimum 2:1 Risk/Reward ratio
- Stop loss required on every trade
- Position size = max_risk ÷ per_share_risk

---

## Reentrenar el modelo ML

Todo vive en `stock-training/ml/`. El proceso tiene 3 pasos: explorar → tunear → entrenar.

### Paso 1 — Explorar combinaciones (grid search)

El grid prueba todas las combinaciones de modelo × feature_set × target **sin tunear hiperparámetros** (usa defaults). Sirve para identificar qué combinación tiene mejor precision@threshold.

```bash
cd stock-training/ml

# Grid completo (todos los modelos × feature sets × targets)
python3 -m experiments.run_grid

# Grid selectivo (más rápido)
python3 -m experiments.run_grid \
  --models LightGBM XGBoost \
  --fsets D_all B_enriched \
  --targets bin_mfr10m_1p5 mc_1p5

# Grid rápido (subsampled, para CatBoost/RandomForest que son lentos)
python3 -m experiments.run_fast_grid \
  --models CatBoost RandomForest \
  --fsets D_all B_enriched \
  --targets bin_mfr10m_1p5 mc_1p5
```

Resultados se guardan en `experiments/results/grid_results.csv`. Columnas clave:
- `prec@0.6`, `signals@0.6` — precisión y volumen de señales a threshold 0.6
- `prec@0.7`, `signals@0.7` — precisión y volumen a threshold 0.7

**Cómo analizar resultados:**
```bash
# Ver mejores por precision@0.6 con señales suficientes
head -1 experiments/results/grid_results.csv  # ver headers
cat experiments/results/grid_results.csv | sort -t',' -k26 -rn | head -10

# Filtrar solo binarios con LightGBM
grep "LightGBM.*bin_mfr10m" experiments/results/grid_results.csv
```

**Modelos disponibles:** XGBoost, LightGBM, CatBoost, RandomForest, ExtraTrees, LogisticRegression

**Feature sets:** A_base, B_enriched, C_price_action, D_all, F_price_vol_time

**Targets disponibles:**
| Target | Tipo | Descripción |
|--------|------|-------------|
| `bin_mfr10m_1p5` | binario | max_future_return_10m ≥ 1.5% |
| `bin_mfr10m_1p0` | binario | max_future_return_10m ≥ 1.0% |
| `bin_mfr10m_2p0` | binario | max_future_return_10m ≥ 2.0% |
| `bin_fr5m_*` | binario | future_return_5m ≥ umbral |
| `bin_break_hod` | binario | rompe high of day en 10 min |
| `mc_1p5` | multiclass | -1/0/+1 según ±1.5% |
| `mc_2p0` | multiclass | -1/0/+1 según ±2.0% |
| `mc_2p5` | multiclass | -1/0/+1 según ±2.5% |

### Paso 2 — Tunear hiperparámetros (Optuna)

Una vez identificada la mejor combinación, editar `CONFIGS` en `experiments/tune_focused.py`:

```python
# experiments/tune_focused.py — línea ~37
CONFIGS = [
    ("LightGBM", "D_all", "bin_mfr10m_1p5"),
    # Agregar más combinaciones si quieres comparar:
    # ("XGBoost", "D_all", "bin_mfr10m_1p5"),
]
```

Parámetros de tuning (mismo archivo):
```python
SUBSAMPLE = 200_000  # filas para tuning (velocidad)
N_TRIALS  = 60       # intentos de Optuna
N_SPLITS  = 3        # folds de walk-forward CV
EMBARGO   = 30       # gap entre train/val (evita leakage)
```

Ejecutar:
```bash
cd stock-training/ml
python3 experiments/tune_focused.py
```

Guarda los mejores hiperparámetros en `experiments/results/tuned_params.json`.

### Paso 3 — Entrenar modelo final

Toma los params tuneados y entrena con el dataset completo (~1M filas). Guarda modelo, scaler, y metadata.

```bash
cd stock-training/ml
python3 -m experiments.train_best --rank 1
```

`--rank 1` = el mejor config de tuned_params.json. Si tuneaste múltiples configs, `--rank 2` sería el segundo mejor, etc.

**Archivos generados en `experiments/results/best_model/`:**
- `model.joblib` — modelo LightGBM/XGBoost serializado
- `scaler.joblib` — StandardScaler fitted
- `meta.json` — metadata: feature_columns, target, class_labels, tuned_params, test_metrics

El endpoint `/predict` lee automáticamente de `best_model/` — no necesita reinicio. `predict.py` detecta si es binary o multiclass desde `meta.json`.

### Verificar el modelo entrenado

```bash
# Ver métricas del modelo guardado
cat stock-training/ml/experiments/results/best_model/meta.json | python3 -m json.tool

# Test end-to-end con debug-predict.js (requiere NestJS corriendo)
cd trading-agent
node scripts/debug-predict.js AIFF 2026-03-04 09:30 10:00 0.6
#                              ^      ^         ^     ^    ^threshold
#                              |      |         |     └ hora fin ET
#                              |      |         └ hora inicio ET  
#                              |      └ fecha
#                              └ ticker
```

El debug-predict muestra cada vela con su probabilidad, si generó señal, el MFR10m real, y si el modelo acertó (Match ✅/❌).

### Ejemplo completo de reentrenamiento

```bash
# 1. Explorar qué combinación es mejor
cd stock-training/ml
python3 -m experiments.run_grid --models LightGBM XGBoost --fsets D_all --targets bin_mfr10m_1p5

# 2. Editar CONFIGS en tune_focused.py con la mejor combinación
#    (ver arriba) ("LightGBM", "D_all", "bin_fr5m_1p5"),

# 3. Tunear
python3 experiments/tune_focused.py

# 4. Entrenar y guardar
python3 -m experiments.train_best --rank 1

# 5. Verificar
cat experiments/results/best_model/meta.json | python3 -m json.tool

# 6. Test con debug-predict (NestJS debe estar corriendo)
cd ../trading-agent
node scripts/debug-predict.js AIFF 2026-03-04 09:30 10:00 0.6
```
