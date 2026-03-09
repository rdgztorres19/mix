# ML Pipeline — Momentum Stock Long Trade Predictor

## Objetivo

Encontrar la mejor combinación de **modelo + features + label** para predecir operaciones long en acciones de momentum (small caps) usando datos de velas de 1 minuto.

---

## Estructura del Proyecto

```
ml/
├── experiments/
│   ├── data_loader.py          # Carga training.csv, temporal split
│   ├── feature_engineer.py     # Calcula ~40 features nuevas, define 5 feature sets
│   ├── target_variants.py      # Define 12 variantes de labels
│   ├── evaluator.py            # Métricas: precision@threshold, logging
│   ├── run_grid.py             # Grid exhaustivo: modelo × features × target
│   ├── run_fast_grid.py        # Grid rápido con subsampling (para RF, CatBoost)
│   ├── tune_focused.py         # Optuna tuning para top configs
│   ├── train_best.py           # Entrena modelo final con params tuneados
│   ├── _full_analysis.py       # Análisis completo de resultados
│   ├── _analyze.py             # Análisis rápido
│   ├── ensemble.py             # Ensembles: voting, stacking, cascading
│   ├── requirements.txt        # Dependencias Python
│   ├── models/
│   │   ├── xgb_native.py       # XGBoost wrapper
│   │   ├── lgbm_model.py       # LightGBM wrapper
│   │   ├── catboost_model.py   # CatBoost wrapper
│   │   ├── rf_optimized.py     # Random Forest wrapper
│   │   ├── extra_trees.py      # Extra Trees wrapper
│   │   └── logistic.py         # Logistic Regression wrapper
│   └── results/
│       ├── grid_results.csv    # Resultados de todos los experimentos
│       ├── tuned_params.json   # Hiperparámetros optimizados
│       └── best_model/         # Modelo final exportado (.joblib)
└── data/
    └── training.csv            # Dataset (~1M filas, 31 columnas base)
```

---

## Requisitos

```bash
pip install pandas scikit-learn numpy joblib xgboost lightgbm catboost optuna
```

O desde el archivo:
```bash
cd stock-training/ml
pip install -r experiments/requirements.txt
pip install optuna  # para tuning
```

---

## Dataset Esperado

El archivo `data/training.csv` debe tener estas columnas base (31):

| Columna | Descripción |
|---------|-------------|
| symbol | Ticker del stock |
| date | Fecha (YYYY-MM-DD) |
| candle_time_et | Hora de la vela (Eastern Time) |
| candle_idx | Índice de la vela en el día (0, 1, 2...) |
| open, high, low, close | OHLC |
| volume | Volumen |
| atr | Average True Range |
| vwap | Volume Weighted Average Price |
| high_of_day, low_of_day | Máximos/mínimos del día |
| change_pct_at_candle | Cambio % acumulado |
| ema9, ema20 | Medias móviles exponenciales |
| pre_market_high | Máximo del premarket |
| shares_outstanding | Acciones en circulación |
| market_cap | Capitalización de mercado |
| gap_pct | Gap % de apertura vs cierre anterior |
| premarket_volume | Volumen de premarket |
| momentum_acumulado | Momentum acumulado |
| change_1m, change_5m, change_10m | Cambio en 1, 5, 10 minutos |
| minutes_since_hod | Minutos desde el High of Day |
| future_return_5m | Return 5 min futuro (para labels) |
| target | Label multiclass original (±2.5%) |
| target_break_hod_5m | Label: rompe HOD en 5 velas |
| max_future_return_10m | Max return en 10 velas futuras |

---

## Guía Paso a Paso: Reentrenar Desde Cero

### Paso 1: Borrar resultados anteriores (opcional)

```bash
cd stock-training/ml
rm -f experiments/results/grid_results.csv
rm -f experiments/results/tuned_params.json
rm -rf experiments/results/best_model/
```

### Paso 2: Correr grid para modelos rápidos (XGBoost + LightGBM)

Esto prueba **todas** las combinaciones de feature sets × targets para XGBoost y LightGBM.
Son los modelos más rápidos y generalmente los mejores.

```bash
cd stock-training/ml
python3 -m experiments.run_grid --models XGBoost LightGBM
```

**Tiempo estimado:** ~30-60 min (120 combos: 2 modelos × 5 fsets × 12 targets)

> El script tiene lógica de skip-completed: si se interrumpe, al re-ejecutar continúa donde se quedó.

### Paso 3: Correr grid para modelos lentos (Random Forest + CatBoost)

Estos modelos son mucho más lentos, así que usamos subsampling (300K filas):

```bash
cd stock-training/ml

# RandomForest — todas las combos
python3 -m experiments.run_fast_grid \
  --models RandomForest \
  --fsets A_base B_enriched C_price_action D_all F_price_vol_time \
  --targets mc_2p5 mc_2p0 mc_1p5 bin_fr5m_2p5 bin_fr5m_2p0 bin_fr5m_1p5 bin_fr5m_1p0 bin_mfr10m_2p5 bin_mfr10m_2p0 bin_mfr10m_1p5 bin_mfr10m_1p0 bin_break_hod

# CatBoost — todas las combos
python3 -m experiments.run_fast_grid \
  --models CatBoost \
  --fsets A_base B_enriched C_price_action D_all F_price_vol_time \
  --targets mc_2p5 mc_2p0 mc_1p5 bin_fr5m_2p5 bin_fr5m_2p0 bin_fr5m_1p5 bin_fr5m_1p0 bin_mfr10m_2p5 bin_mfr10m_2p0 bin_mfr10m_1p5 bin_mfr10m_1p0 bin_break_hod
```

**Tiempo estimado:** ~15-30 min cada uno (con subsampling)

### Paso 4: Analizar resultados del grid

```bash
cd stock-training/ml
python3 experiments/_full_analysis.py
```

Esto imprime:
- **Top 20** combinaciones por prec@0.7
- **Mejor modelo** por cada target
- **Mejor modelo** por cada feature set
- **Score compuesto** (precision × señales) — el ranking final

### Paso 5: Tuning de hiperparámetros (top 5 configs)

Edita `tune_focused.py` si quieres cambiar las 5 configs a tunear (basándote en los resultados del paso 4). Luego:

```bash
cd stock-training/ml
python3 experiments/tune_focused.py 2>&1 | tee /tmp/tune_output.txt
```

**Tiempo estimado:** ~2-3 horas (5 configs × 60 trials × 3-fold CV)

> Para monitorear progreso: `tail -5 /tmp/tune_output.txt`
> Los resultados se guardan en `experiments/results/tuned_params.json`

### Paso 6: Entrenar modelo final

```bash
cd stock-training/ml
python3 -m experiments.train_best
```

Esto:
1. Lee los mejores parámetros de `tuned_params.json`
2. Entrena con todo el training set
3. Evalúa en el test set temporal
4. Exporta el modelo a `results/best_model/`

### Paso 7: Verificar el modelo exportado

```bash
ls -la experiments/results/best_model/
# Debería contener:
#   model.joblib      — modelo entrenado
#   scaler.joblib     — StandardScaler fitted
#   metadata.json     — config: features, target, params, métricas
```

---

## Feature Sets

| Set | Columnas | Descripción |
|-----|----------|-------------|
| **A_base** | 23 | Columnas crudas del CSV (OHLCV, ATR, VWAP, EMAs, etc.) |
| **B_enriched** | ~53 | A_base + distancias a niveles, RSI, momentum, volume features, time flags |
| **C_price_action** | ~36 | A_base + candlestick patterns, distancias, break HOD |
| **D_all** | ~70 | Todas las features (B + C + extras: ROC, consolidation, OBV, etc.) |
| **F_price_vol_time** | ~43 | Solo price action + volume + time (sin fundamentales: sin market_cap, shares) |

### Features Calculadas (en memoria, nunca modifica el CSV)

**Price Action:** body_pct, upper/lower_wick_pct, is_green, bar_range_vs_atr, consecutive_green/red, range_expansion, pct_of_day_range, spread_estimate, dist_to_round_number

**Distancias a Niveles:** dist_vwap_pct, dist_hod_pct, dist_lod_pct, dist_ema9, dist_ema20, dist_pm_high, dist_gap, break_hod, break_pm_high, vwap_cross_up, gap_filled

**Volume:** volume_rel, volume_spike, volume_acceleration, cumulative_volume_ratio, dollar_volume, relative_dollar_volume, obv_slope_5, volume_price_trend, float_rotation

**Momentum:** rsi, roc_3/5/10/20, return_lag_1/2/3, mom_5, mom_10, momentum_acceleration, momentum_divergence

**Volatilidad:** volatility_15m, volatility_ratio, consolidation_score, atr_rel, relative_range

**Tiempo:** minute_of_day, time_since_open_min, is_premarket, is_first_30min, is_open, is_midday, is_power_hour, is_last_hour

---

## Target Labels (12 variantes)

### Multiclass (-1/0/+1)
| Target | Umbral | Descripción |
|--------|--------|-------------|
| mc_2p5 | ±2.5% | Original: future_return_5m > 2.5% → +1, < -2.5% → -1 |
| mc_2p0 | ±2.0% | Más sensible |
| mc_1p5 | ±1.5% | **Más sensible — generalmente el mejor target** |

### Binary (0/1) — future_return_5m
| Target | Umbral | Descripción |
|--------|--------|-------------|
| bin_fr5m_2p5 | >2.5% | ¿Sube >2.5% en 5 min? |
| bin_fr5m_2p0 | >2.0% | |
| bin_fr5m_1p5 | >1.5% | |
| bin_fr5m_1p0 | >1.0% | |

### Binary (0/1) — max_future_return_10m
| Target | Umbral | Descripción |
|--------|--------|-------------|
| bin_mfr10m_2p5 | >2.5% | ¿Sube >2.5% en algún momento de las próximas 10 velas? |
| bin_mfr10m_2p0 | >2.0% | |
| bin_mfr10m_1p5 | >1.5% | |
| bin_mfr10m_1p0 | >1.0% | |

### Break HOD
| Target | Descripción |
|--------|-------------|
| bin_break_hod | ¿Rompe el High of Day en las próximas 5 velas? |

---

## Modelos Disponibles

| Modelo | Script | Notas |
|--------|--------|-------|
| **XGBoost** | models/xgb_native.py | 300 estimators, depth 6, lr 0.05. Generalmente el mejor. |
| **LightGBM** | models/lgbm_model.py | Similar a XGBoost, ligeramente más rápido |
| **CatBoost** | models/catboost_model.py | 300 iterations, auto class weights. Muy lento. |
| **RandomForest** | models/rf_optimized.py | 200 trees, depth 12. Usa subsampling. |
| **ExtraTrees** | models/extra_trees.py | 200 trees. Similar a RF. |
| **LogisticRegression** | models/logistic.py | Baseline lineal |

---

## Métricas Clave

- **prec@0.7** — Precisión cuando el modelo predice "long" con >70% de confianza. **Métrica principal.**
- **signals@0.7** — Cuántas señales genera con ese umbral de confianza. Si hay muy pocas (<100), el modelo no es práctico.
- **Score compuesto** — Combina precisión y volumen de señales para el ranking final.

---

## Evaluación

- **Split temporal** 80/20 con 30 filas de embargo entre train y test
- **Walk-forward CV** (3 folds) para tuning
- La clase bullish está desbalanceada → se usan sample weights
- Se usa StandardScaler para normalizar features

---

## Cuándo Re-entrenar

Re-ejecuta el pipeline completo (pasos 1-7) cuando:

1. **Agregues más datos** al training.csv (nuevos días/stocks)
2. **El mercado cambie significativamente** (ej. de bull market a bear market)
3. **El modelo degradé su performance** en producción (precision baja)
4. **Cada 1-3 meses** como mantenimiento preventivo

---

## Comandos Rápidos de Referencia

```bash
# === PIPELINE COMPLETO ===
cd stock-training/ml

# 1. Grid XGBoost + LightGBM (rápido)
python3 -m experiments.run_grid --models XGBoost LightGBM

# 2. Grid RandomForest (subsampling)
python3 -m experiments.run_fast_grid --models RandomForest \
  --fsets A_base B_enriched C_price_action D_all F_price_vol_time \
  --targets mc_2p5 mc_2p0 mc_1p5 bin_fr5m_2p5 bin_fr5m_2p0 bin_fr5m_1p5 bin_fr5m_1p0 bin_mfr10m_2p5 bin_mfr10m_2p0 bin_mfr10m_1p5 bin_mfr10m_1p0 bin_break_hod

# 3. Grid CatBoost (subsampling)
python3 -m experiments.run_fast_grid --models CatBoost \
  --fsets A_base B_enriched C_price_action D_all F_price_vol_time \
  --targets mc_2p5 mc_2p0 mc_1p5 bin_fr5m_2p5 bin_fr5m_2p0 bin_fr5m_1p5 bin_fr5m_1p0 bin_mfr10m_2p5 bin_mfr10m_2p0 bin_mfr10m_1p5 bin_mfr10m_1p0 bin_break_hod

# 4. Analizar resultados
python3 experiments/_full_analysis.py

# 5. Tunear top configs (editar tune_focused.py si cambió el top)
python3 experiments/tune_focused.py 2>&1 | tee /tmp/tune_output.txt

# 6. Entrenar modelo final
python3 -m experiments.train_best

# === MONITOREO ===
tail -5 /tmp/tune_output.txt                    # progreso del tuning
wc -l experiments/results/grid_results.csv      # cuántos experimentos hay
grep "XGBoost" experiments/results/grid_results.csv | wc -l  # por modelo

# === VERIFICAR MODELO ===
ls experiments/results/best_model/
cat experiments/results/tuned_params.json | python3 -m json.tool
```

---

## Resumen de Resultados (Grid - 189 experimentos)

| Modelo | Feature Set | Target | prec@0.7 | Señales |
|--------|-------------|--------|----------|---------|
| XGBoost | D_all | mc_1p5 | ~68% | ~1,660 |
| LightGBM | D_all | mc_1p5 | ~68% | ~1,660 |
| XGBoost | B_enriched | mc_1p5 | ~68% | ~1,660 |
| RandomForest | F_price_vol_time | mc_1p5 | ~78% | ~85 (pocas) |

> **Hallazgo clave:** `mc_1p5` es el target ganador. XGBoost y LightGBM con feature sets D_all o B_enriched son los mejores modelos prácticos (buena precisión + suficientes señales).

> Los resultados finales con tuning de hiperparámetros se actualizarán al completar el paso 5.

---

## Integración con Node.js API

El modelo exportado en `results/best_model/` se integra con el trading-agent NestJS:

1. **Python spawn** (actual): El `PredictorService` hace spawn de Python, pasa las features, recibe `{tradeable, prob, threshold}`
2. **ONNX** (alternativa): Exportar modelo a ONNX y cargarlo directo en Node.js con `onnxruntime-node` (sin dependencia Python, ~10x más rápido)

---

## Consumo del Modelo de Predicción

### Modelo Actual en Producción

| Campo | Valor |
|-------|-------|
| **Modelo** | LightGBM (D_all) |
| **Target** | mc_1p5 (multiclass: -1/0/+1, umbral ±1.5%) |
| **Threshold recomendado** | 0.6 (prec=79.3%, ~247 señales en test) |
| **Feature set** | D_all (~85 features, las 23 base + ~62 calculadas) |
| **Archivos** | `experiments/results/best_model/model.joblib`, `scaler.joblib`, `meta.json` |

### Endpoint API — `POST /predict`

El trading-agent (NestJS, puerto 3033) expone un endpoint para predicción:

```
POST http://localhost:3033/predict?threshold=0.6
Content-Type: application/json
```

#### Body (JSON)

Todas las features son opcionales (default 0 si no se envían). Las features mínimas recomendadas:

```json
{
  "candle_idx": 45,
  "open": 5.20,
  "high": 5.55,
  "low": 5.10,
  "close": 5.40,
  "volume": 150000,
  "atr": 0.35,
  "vwap": 5.25,
  "high_of_day": 5.80,
  "low_of_day": 4.90,
  "change_pct_at_candle": 8.5,
  "ema9": 5.30,
  "ema20": 5.15,
  "pre_market_high": 5.60,
  "shares_outstanding": 25000000,
  "market_cap": 135000000,
  "gap_pct": 12.0,
  "premarket_volume": 500000,
  "momentum_acumulado": 0.08,
  "change_1m": 0.5,
  "change_5m": 2.1,
  "change_10m": 3.5,
  "minutes_since_hod": 10
}
```

#### Query Parameters

| Param | Default | Descripción |
|-------|---------|-------------|
| `threshold` | `0.6` | Umbral de probabilidad para considerar tradeable. Rango 0–1. |

#### Respuesta

```json
{
  "tradeable": true,
  "prob": 0.7342,
  "threshold": 0.6
}
```

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `tradeable` | boolean | `true` si `prob >= threshold` — el modelo recomienda operar long |
| `prob` | number | Probabilidad de clase +1 (long > 1.5% en 5 min). Rango 0–1. |
| `threshold` | number | El umbral usado para la decisión |

### Features del Body — Referencia Completa

Las 23 features base que acepta el endpoint:

| Feature | Tipo | Descripción | Ejemplo |
|---------|------|-------------|---------|
| `candle_idx` | int | Índice de la vela en el día (0 = primera del premarket) | 45 |
| `open` | float | Precio de apertura de la vela | 5.20 |
| `high` | float | Precio máximo de la vela | 5.55 |
| `low` | float | Precio mínimo de la vela | 5.10 |
| `close` | float | Precio de cierre de la vela | 5.40 |
| `volume` | int | Volumen de la vela | 150000 |
| `atr` | float | Average True Range (volatilidad) | 0.35 |
| `vwap` | float | VWAP acumulado (Volume Weighted Avg Price) | 5.25 |
| `high_of_day` | float | Máximo del día hasta ese momento | 5.80 |
| `low_of_day` | float | Mínimo del día hasta ese momento | 4.90 |
| `change_pct_at_candle` | float | Cambio % acumulado desde apertura | 8.5 |
| `ema9` | float | Media móvil exponencial de 9 períodos | 5.30 |
| `ema20` | float | Media móvil exponencial de 20 períodos | 5.15 |
| `pre_market_high` | float | Máximo del premarket | 5.60 |
| `shares_outstanding` | float | Acciones en circulación | 25000000 |
| `market_cap` | float | Capitalización de mercado | 135000000 |
| `gap_pct` | float | Gap % de apertura vs cierre día anterior | 12.0 |
| `premarket_volume` | int | Volumen total del premarket | 500000 |
| `momentum_acumulado` | float | Momentum acumulado intra-día | 0.08 |
| `change_1m` | float | Cambio % del último 1 minuto | 0.5 |
| `change_5m` | float | Cambio % de los últimos 5 minutos | 2.1 |
| `change_10m` | float | Cambio % de los últimos 10 minutos | 3.5 |
| `minutes_since_hod` | float | Minutos desde que se hizo el High of Day | 10 |

> **Nota:** El modelo D_all usa ~85 features en total. Las ~62 features adicionales (RSI, ROC, dist_vwap_pct, volume_rel, etc.) son calculadas automáticamente por el script Python `feature_engineer.py` a partir de estas 23 base. Cuando se llama desde el API actual, solo se pasan las 23 base y el script Python las enriquece internamente.

### Endpoint Evaluación — `GET /predict/evaluate`

Permite evaluar el modelo actual contra el dataset de test:

```
GET http://localhost:3033/predict/evaluate?threshold=0.6
```

Respuesta incluye: `threshold_comparison`, `classification` (precision/recall/f1 por clase), `confusion_matrix`.

### Desde el UI (Trading UI)

Al hacer hover sobre cualquier vela en el chart, aparece un tooltip con:
- **OHLCV** (Open, High, Low, Close, Volume)
- **Indicadores**: VWAP, EMA9, EMA20, RSI14

El tooltip incluye un botón **"🔮 Predecir"** que:
1. Toma los datos de la vela actual + indicadores calculados localmente
2. Envía `POST /api/predict?threshold=0.6` con las features
3. Muestra el resultado inline: **✅ LONG 73%** o **❌ NO 32%**

Las features enviadas desde el UI son: `candle_idx`, `open`, `high`, `low`, `close`, `volume`, `atr`, `vwap` (calculado localmente), `high_of_day`, `low_of_day`, `change_pct_at_candle`, `ema9` (calculado localmente), `ema20` (calculado localmente), `pre_market_high`.

### Consumo Directo con Python (sin API)

```python
import json, sys, subprocess

features = {
    "candle_idx": 45,
    "open": 5.20, "high": 5.55, "low": 5.10, "close": 5.40,
    "volume": 150000, "atr": 0.35, "vwap": 5.25,
    "high_of_day": 5.80, "low_of_day": 4.90,
    "change_pct_at_candle": 8.5,
    "ema9": 5.30, "ema20": 5.15,
    "pre_market_high": 5.60,
    "_threshold": 0.6
}

proc = subprocess.run(
    ["python3", "ml/random_forest/predict.py"],
    input=json.dumps(features),
    capture_output=True, text=True,
    cwd="/path/to/stock-training"
)
result = json.loads(proc.stdout)
# {"tradeable": true, "prob": 0.7342, "threshold": 0.6}
```

### Consumo con cURL

```bash
curl -X POST http://localhost:3033/predict?threshold=0.6 \
  -H "Content-Type: application/json" \
  -d '{
    "candle_idx": 45,
    "open": 5.20, "high": 5.55, "low": 5.10, "close": 5.40,
    "volume": 150000, "atr": 0.35, "vwap": 5.25,
    "high_of_day": 5.80, "low_of_day": 4.90,
    "change_pct_at_candle": 8.5,
    "ema9": 5.30, "ema20": 5.15,
    "pre_market_high": 5.60
  }'
```

### Interpretación de Resultados

| prob | threshold=0.6 | Acción |
|------|---------------|--------|
| ≥ 0.7 | ✅ tradeable | **Alta confianza** — señal fuerte de long |
| 0.6–0.7 | ✅ tradeable | **Confianza moderada** — operar con confirmación adicional |
| < 0.6 | ❌ no tradeable | No operar — probabilidad insuficiente |

> **Recomendación de producción:** Usar `threshold=0.6` como default. A 0.6, el modelo tuvo **79.3% de precisión** con **247 señales** en el test set (~1 señal cada 843 velas). Para ser más conservador, usar `threshold=0.7` pero generará muy pocas señales.
