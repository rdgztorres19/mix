# Informe Completo: Sistema ML para Prediccion de Stock Market

**Autor:** Manuel Rodriguez  
**Fecha:** Abril 2026  
**Branch:** `feat/ml-pipeline-v2`

---

## 1. Vision General del Sistema

El sistema busca predecir movimientos intraday de acciones usando modelos de Machine Learning. Opera en dos mercados:

- **Momentum Stocks** — acciones de baja/media capitalizacion que tienen movimientos de 5-50% intraday (gappers, gainers, HOD breakouts)
- **S&P 500 (SPY)** — ETF del indice, movimientos de 0.05-0.3% por candle, 1 solo instrumento

La infraestructura incluye: screener/scanner de stocks, pipeline de datos, feature engineering, 7+ modelos ML, grid search, backtest simulator, y pipeline de noticias.

---

## 2. Como Funciona el Scanner/Screener

### 2.1 Fuente de Datos
- **Alpaca Markets API** (premium SIP feed) para datos en tiempo real
- WebSocket para candles de 1 minuto
- REST API para snapshots, barras historicas, y noticias

### 2.2 Cinco Rankings de Stocks

El screener clasifica ~11,000 acciones en 5 categorias cada ciclo (cada 5 minutos):

| Ranking | Que mide | Formula |
|---------|----------|---------|
| **Gapper** | Gap del premarket | (open - prev_close) / prev_close |
| **Gainer Session** | Ganancia del dia (close) | (daily_close - prev_close) / prev_close |
| **Gainer Intraday** | Ganancia actual (last trade) | (last_trade - prev_close) / prev_close |
| **High Session** | HOD vs cierre anterior | (daily_high - prev_close) / prev_close |
| **High Current** | High actual vs cierre anterior | max(daily_high, last_trade) / prev_close |

### 2.3 Lista Combinada
1. Top 40 de cada ranking (200 total)
2. Deduplicar por simbolo (mantener max score)
3. Ordenar globalmente por score descendente
4. Mantener top 40 finales
5. Filtros: volumen minimo > 250,000 acciones/dia

### 2.4 Flujo del Screener en Backtest
```
data/{fecha}/bars-1m.json.gz  →  Cargar barras historicas
                               →  Construir snapshots sinteticos
                               →  Computar 5 rankings
                               →  Combinar top 40
                               →  Para cada simbolo: computar features → predecir → evaluar TP/SL
```

---

## 3. Estructura de Datos

### 3.1 CSV de Stocks (57 columnas)

**Identificadores (4):**
- `symbol`, `date`, `candle_time_et`, `candle_idx`

**OHLCV (5):**
- `open`, `high`, `low`, `close`, `volume`

**Indicadores Tecnicos (6):**
- `atr`, `vwap`, `high_of_day`, `low_of_day`, `ema9`, `ema20`

**Contexto de Sesion (5):**
- `pre_market_high`, `session`, `change_pct_at_candle`, `gap_pct`, `premarket_volume`

**Fundamentales (2):**
- `shares_outstanding`, `market_cap`

**Cambios de Precio (4):**
- `momentum_acumulado`, `change_1m`, `change_5m`, `change_10m`, `minutes_since_hod`

**Features Enriquecidos (~30):**
- `volume_rel`, `dist_vwap_pct`, `atr_rel`, `minute_of_day`, `rsi`, `volatility_15m`
- `mom_5`, `mom_10`, `return_lag_1/2/3`, `dist_hod_pct`, `dist_lod_pct`
- `break_hod`, `break_pm_high`, `range_expansion`, `float_rotation`
- `dollar_volume`, `volume_spike`, `vwap_cross_up`, `dist_ema9/20`
- `momentum_acceleration`, `is_open`, `is_midday`, `is_power_hour`

**Labels (4):**
- `future_return_5m`, `target` (multiclass -1/0/1), `target_break_hod_5m`, `max_future_return_10m`

### 3.2 CSV de SPY (30 columnas)

Misma estructura base pero con columnas adicionales de VIX proxy:
- `uvxy_close`, `uvxy_change_pct`, `uvxy_volume`
- `future_return_5m/10m`, `max_future_return_10m`, `min_future_return_10m`

### 3.3 Volumenes de Datos

| Dataset | Filas | Rango | Peso |
|---------|-------|-------|------|
| `training-v2-morning-full.csv` | 8M | 2023-2026 | ~2.7 GB |
| `training-v2-morning-full-with-news.csv` | 8M | 2023-2026 | ~3 GB |
| `sp500_training.csv` | 664K | 2023-2026 | ~100 MB |
| Noticias (`news.json.gz` por dia) | ~800 dias | 2023-2026 | ~500 MB total |

---

## 4. Feature Engineering

### 4.1 Features para Stocks (~86 features computados)

**Price Action (10):**
- `body_pct` — (close-open)/open, tamano y direccion de la vela
- `upper_wick_pct` — mecha superior vs ATR (rechazo)
- `lower_wick_pct` — mecha inferior vs ATR (presion compradora)
- `is_green` — vela alcista (1) o bajista (0)
- `bar_range_vs_atr` — tamano de barra vs ATR (expansion de volatilidad)
- `close_position` — donde cerro en el rango high-low (0=bajo, 1=alto)
- `bar_range_pct` — rango como % del precio
- `range_expansion` — rango actual vs rango del dia
- `pct_of_day_range` — posicion dentro del rango diario
- `relative_range` — rango vs promedio 20 barras

**Distancias a Niveles Clave (12):**
- `dist_vwap_pct` — distancia a VWAP (valor institucional)
- `dist_hod_pct` — distancia al maximo del dia
- `dist_lod_pct` — distancia al minimo del dia
- `dist_ema9/20` — distancia a medias moviles
- `dist_pm_high` — distancia al high del premarket
- `dist_gap` — distancia al precio de apertura
- `dist_day_open` — distancia al open del dia
- `dist_high_5/low_5` — distancia a high/low de ultimas 5 barras
- `dist_prev_hod_pct` — distancia al HOD previo
- `atr_rel` — ATR como % del precio (regimen de volatilidad)

**Momentum (15):**
- `rsi` (14-period), `stochastic_k/d`, `cci`, `williams_r`
- `roc_3/5/10/20` — rate of change a diferentes periodos
- `return_lag_1/2/3` — retornos rezagados
- `mom_5/10` — momentum absoluto
- `momentum_acceleration` — mom_5 - mom_10
- `return_accel_1m/5m` — aceleracion de retornos
- `bollinger_pct_b` — posicion dentro de bandas de Bollinger (#1 en estudios de ablacion)

**Volumen (10):**
- `volume_rel` — volumen vs promedio 20 barras
- `volume_spike` — volume_rel > 3x (1/0)
- `volume_acceleration` — cambio en volume_rel
- `buy_volume_ratio` — estimacion de presion compradora
- `float_rotation` — volumen acumulado / shares outstanding
- `dollar_volume` — close x volume
- `relative_dollar_volume` — dollar volume vs promedio
- `cumulative_volume_ratio` — volumen acumulado vs esperado
- `vol_trend_5` — tendencia de volumen (5 barras)
- `vol_concentration_5` — concentracion de volumen

**Volatilidad (6):**
- `volatility_15m` — desviacion de retornos en 15 min
- `volatility_ratio` — volatilidad corta vs larga
- `consolidation_score` — cuan comprimido esta el precio
- `close_std5` — desviacion del close en 5 barras
- `parkinson_vol` — volatilidad OHLC (5x mas eficiente)

**Breakout (6):**
- `break_hod` — rompe el HOD (1/0)
- `break_pm_high` — rompe el high del premarket
- `break_high_5` — rompe el high de 5 barras
- `vwap_cross_up` — cruza VWAP hacia arriba
- `gap_filled` — gap se lleno
- `ema_spread/change` — spread entre EMAs y su cambio

**Contexto Temporal (5):**
- `minute_of_day` — minuto del dia (570 = 09:30)
- `is_first_30min`, `is_open`, `is_midday`, `is_power_hour`
- `time_since_open_min` — minutos desde apertura
- `minutes_since_hod` — minutos desde el ultimo HOD

### 4.2 Features Especificos de SPY (~50 features)

Todo lo anterior mas:

**VIX Proxy (UVXY) — Predictor #1 para SPY:**
- `vix_proxy_level` — precio UVXY
- `vix_proxy_change` — cambio % UVXY
- `vix_proxy_volume_rel` — volumen relativo UVXY
- `uvxy_change_5m` — cambio UVXY en 5 min (spike de miedo)
- `uvxy_rsi` — RSI del UVXY
- `spy_uvxy_corr_20` — correlacion SPY-UVXY rolling 20 barras

**Microestructura:**
- `return_autocorr_20` — autocorrelacion de retornos (negativa = mean-reversion)
- `amihud_illiquidity` — ratio de iliquidez (|return| / dollar_volume)
- `kyle_lambda` — impacto de precio por volumen
- `vwap_slope_norm` — pendiente del VWAP (flujo institucional)

**Volatilidad Multi-Escala:**
- `volatility_5m/15m/30m` — a diferentes escalas
- `vol_ratio_5_30/5_15` — ratio micro vs macro
- `parkinson_vol` — volatilidad basada en OHLC

### 4.3 Feature Sets Probados

**Para Stocks (15 sets):**

| Feature Set | # Features | Descripcion |
|-------------|-----------|-------------|
| A_base | 23 | Solo columnas del CSV |
| B_enriched | 53 | CSV + todos los features computados |
| C_price_action | 36 | Precio + estructura |
| D_all | 79 | Todo |
| D_clean | 70 | Sin ruido |
| D_clean_ext | 71 | Clean + extensiones |
| D1_core_momentum | 47 | Momentum puro |
| D2_breakout_structure | 37 | Senales de breakout |
| D3_liquidity_context | 33 | Volumen + liquidez |
| V2_core | 42 | Features relativos core |
| V2_full | 76 | Todos los relativos |
| V2_momentum | 37 | Momentum relativo |
| V3 | 89 | V2 + indicadores Tier 1 |
| V3_tier1 | 55 | Solo los mejores |
| news_only | 10 | Solo features de noticias |

**Para LSTM Sequences (10 sets):**

| Feature Set | # Features | Descripcion |
|-------------|-----------|-------------|
| full_30 | 30 | Todas las features de secuencia |
| lean_12 | 12 | Solo features unicos (sin correlacion) |
| momentum_15 | 15 | Price action + momentum |
| vol_volume_12 | 12 | Volumen + volatilidad |
| structure_14 | 14 | Distancias + breakout |
| oscillators_10 | 10 | RSI, Stochastic, CCI, Williams, Bollinger |
| raw_8 | 8 | Datos crudos por vela (sin indicadores) |
| raw_12 | 12 | Raw + contexto |
| lean_news_22 | 22 | Lean + 10 features de noticias |
| news_only_10 | 10 | Solo noticias |

**Para SPY (7 sets):**

| Feature Set | # Features | Descripcion |
|-------------|-----------|-------------|
| A_base | 23 | CSV base |
| B_enriched | ~74 | Todo |
| C_price_action | ~20 | Estructura |
| D_momentum | ~25 | Momentum + vol |
| E_clean | ~23 | Curado |
| F_all | ~74 | Igual que B |
| G_spy_optimized | 26 | **Optimizado para SPY** (VIX, vol, microstructure) |

### 4.4 Features de Noticias (10 columnas)

Descargadas de Alpaca News API, clasificadas con keyword matching:

| Feature | Descripcion |
|---------|------------|
| `has_news_premarket` | Tuvo noticia entre 4:00-9:30 AM |
| `has_news_1h` | Noticia en la ultima hora |
| `news_count_today` | Total noticias hoy (sin future leakage) |
| `news_count_premarket` | Noticias en premarket |
| `hours_since_news` | Horas desde ultima noticia (24=sin news) |
| `catalyst_strength` | 0=NONE, 1=WEAK, 2=MODERATE, 3=STRONG |
| `catalyst_is_dilutive` | Offering/dilucion (bearish) |
| `catalyst_is_earnings` | Earnings beat |
| `catalyst_is_fda` | FDA approval |
| `catalyst_is_buyout` | Buyout/acquisition/merger |

---

## 5. Targets (Variables a Predecir)

### 5.1 Targets de Stocks (40+ targets)

**Triple Barrier (TP/SL) — 12 variantes:**
El precio toca TP antes que SL dentro de N candles.

| Target | TP | SL | Horizonte | Break-even WR |
|--------|----|----|-----------|---------------|
| `bin_tb5m_tp2p0_sl1p0` | +2% | -1% | 5 min | 33.3% |
| `bin_tb10m_tp1p5_sl0p5` | +1.5% | -0.5% | 10 min | 25% |
| `bin_tb10m_tp2p0_sl0p7` | +2% | -0.7% | 10 min | 25.9% |
| `bin_tb10m_tp2p5_sl1p0` | +2.5% | -1% | 10 min | 28.6% |
| `bin_tb10m_tp4p0_sl2p0` | +4% | -2% | 10 min | 33.3% |
| `bin_tb10m_tp5p0_sl2p5` | +5% | -2.5% | 10 min | 33.3% |
| `bin_tb10m_tp6p0_sl3p0` | +6% | -3% | 10 min | 33.3% |
| `bin_tb15m_tp3p0_sl1p5` | +3% | -1.5% | 15 min | 33.3% |
| `bin_tb30m_tp4p0_sl2p0` | +4% | -2% | 30 min | 33.3% |
| `bin_tb30m_tp3p0_sl1p5` | +3% | -1.5% | 30 min | 33.3% |
| `bin_tb60m_tp4p0_sl2p0` | +4% | -2% | 60 min | 33.3% |

**Reward/Risk — 5 variantes:**
Max upside / Max downside en N candles.

| Target | Condicion | Positivos |
|--------|-----------|-----------|
| `bin_rr5m_ge_2` | R/R en 5m >= 2 | ~35% |
| `bin_rr10m_ge_2` | R/R en 10m >= 2 | ~36% |
| `bin_rr10m_ge_3` | R/R en 10m >= 3 | ~29% |
| `bin_rr30m_ge_2` | R/R en 30m >= 2 | ~36% |
| `mc_rr10m` | Multiclass por R/R | 3 clases |

**Volatility Expansion — 8 variantes (NUEVOS):**
Rango futuro (max_high - min_low) vs ATR o % fijo.

| Target | Condicion | Descripcion |
|--------|-----------|-------------|
| `bin_vol_exp_5m_2atr` | Rango 5m >= 2x ATR | Movimiento rapido |
| `bin_vol_exp_10m_2atr` | Rango 10m >= 2x ATR | Big move coming |
| `bin_vol_exp_10m_3atr` | Rango 10m >= 3x ATR | Very big move |
| `bin_vol_exp_30m_3atr` | Rango 30m >= 3x ATR | Movimiento sostenido |
| `bin_vol_exp_10m_3pct` | Rango 10m >= 3% | Fijo, sin ATR |
| `bin_vol_exp_10m_5pct` | Rango 10m >= 5% | Solo los grandes |
| `bin_vol_exp_30m_5pct` | Rango 30m >= 5% | Extendido |
| `bin_vol_rr_10m` | Big move + R/R >= 2 | Combinado |

**Otros targets:**
- `bin_break_hod` — rompe HOD en 5 candles
- `bin_follow_through_hod_10m_0p5/1p0` — rompe HOD y extiende
- `bin_opportunity_clean_10m_1p5_0p5` — sube +1.5% sin caer -0.5%
- `bin_sustained_momentum_10m` — close[t+10] > close[t+5] > close[t]
- `bin_morning_breakout_5m` — rompe HOD y extiende +1% en 5 min
- 7 targets bearish (drops, SL before TP, breakdown LOD)

### 5.2 Targets de SPY (9 targets)

**Vol-Scaled Triple Barrier** (se adapta al regimen de VIX):

| Target | TP | SL | Horizonte |
|--------|----|----|-----------|
| `vs_tb10m_10_07` | 1.0x vol | 0.7x vol | 10 min |
| `vs_tb10m_15_10` | 1.5x vol | 1.0x vol | 10 min |
| `vs_tb10m_20_10` | 2.0x vol | 1.0x vol | 10 min |
| `vs_tb30m_15_10` | 1.5x vol | 1.0x vol | 30 min |
| `vs_tb30m_20_10` | 2.0x vol | 1.0x vol | 30 min |
| `vs_tb60m_20_10` | 2.0x vol | 1.0x vol | 60 min |

**Reward/Risk:**
- `bin_rr10m_ge_2/3`, `bin_rr30m_ge_2`

---

## 6. Modelos y Arquitecturas

### 6.1 Modelos de Arboles (Tabulares)

| Modelo | Params Default | Notas |
|--------|---------------|-------|
| **XGBoost** | 300 trees, depth=6, lr=0.05 | GPU-optional, hist tree method |
| **LightGBM** | 300 trees, depth=6, lr=0.05 | Mas rapido, verbose=-1 |
| **CatBoost** | 300 iter, depth=6, lr=0.05 | Auto class weights |
| **RandomForest** | balanced weights | Bootstrap ensemble |
| **ExtraTrees** | balanced weights | Mas aleatorio que RF |
| **LogisticRegression** | baseline | L2 penalty |

### 6.2 Modelos Secuenciales (PyTorch)

| Modelo | Arquitectura | Params |
|--------|-------------|--------|
| **LSTMMomentum** | 2-layer LSTM(64) → Linear(32) → Linear(1) | ~50K |
| **GRUMomentum** | 2-layer GRU(64) → Linear(32) → Linear(1) | ~40K |
| **LSTMWithAttention** | LSTM(64) + Soft Attention → Linear(32) → Linear(1) | ~55K |
| **CNNLSTMAttention** | Conv1d(64→128) + BN → LSTM(64) + Attention → Linear(32) → Linear(1) | ~116K |
| **TransformerMomentum** | Positional Encoding + TransformerEncoder(d=64, nhead=4) → Linear(32) → Linear(1) | ~80K |

**Hiperparametros optimizados (basados en research):**
- batch_size = 32 (research: 32-64 optimal)
- learning_rate = 0.001 (73% mejor que 0.0001)
- seq_len = 60 (validado como optimo para momentum)
- dropout = 0.3
- RobustScaler (median/IQR) en vez de StandardScaler
- BCEWithLogitsLoss con pos_weight (no Focal Loss — causa calibration collapse)

---

## 7. Experimentos Ejecutados

### 7.1 Grid Search de Arboles (Stocks)

**112 combinaciones** corridas (run_grid.py):
- 6 modelos x 15 feature sets x 9 targets
- Temporal split 80/20 con embargo de 30 rows
- Metricas: accuracy, precision, recall, F1, P@0.4/0.5/0.6/0.7/0.8

**Mejores resultados (P@0.70):**

| Modelo | Features | Target | P@0.70 | Senales |
|--------|----------|--------|--------|---------|
| XGBoost | V2_core | bin_rr10m_ge_2 | 0.608 | 2,759 |
| XGBoost | D_clean | bin_rr10m_ge_2 | 0.602 | 5,783 |
| XGBoost | V3 | bin_rr10m_ge_2 | 0.601 | 4,428 |
| XGBoost | V2_full | bin_rr10m_ge_2 | 0.537 | 9,421 |

**Volatility Expansion (direction-agnostic):**

| Modelo | Target | P@0.70 | P@0.80 | Senales@0.80 |
|--------|--------|--------|--------|-------------|
| XGBoost | vol_exp_30m_3atr | 0.960 | 0.974 | 147K |
| XGBoost | vol_exp_10m_2atr | 0.939 | 0.964 | 70K |
| XGBoost | vol_exp_10m_3pct | 0.757 | 0.812 | 597K |
| XGBoost | vol_exp_10m_3atr | 0.769 | 0.858 | 47K |

### 7.2 Grid Search de LSTM (Stocks)

**28 combinaciones** corridas (run_sequence_grid.py):
- 3 modelos (cnn_lstm, lstm_attention, lstm) x 10 feature sets x 6 targets
- batch=128, seq_len=60, max_rows=2M

**Mejores resultados:**

| Modelo | Features | Target | AUC | P@0.70 |
|--------|----------|--------|-----|--------|
| cnn_lstm | vol_volume_12 | tb30m_tp3p0_sl1p5 | 0.707 | 0.342 |
| cnn_lstm | momentum_15 | tb30m_tp3p0_sl1p5 | 0.705 | 0.335 |
| cnn_lstm | full_30 | tb5m_tp2p0_sl1p0 | 0.811 | 0.303 |

### 7.3 Grid Search de SPY

**223 combinaciones** corridas:
- 5 modelos x 7 feature sets x 6 targets

**Mejores resultados:**

| Modelo | Features | Target | P@0.70 | Senales |
|--------|----------|--------|--------|---------|
| XGBoost | G_spy_optimized | bin_rr10m_ge_2 | 0.719 | 335 |
| XGBoost | G_spy_optimized | vs_tb10m_10_07 | 0.765 | 51 |
| XGBoost | B_enriched | vs_tb10m_15_10 | 0.714 | 84 |

### 7.4 News Features

**Resultado: CERO mejora.**
- V2_full_news vs V2_full: identicos en P@threshold en todos los targets
- news_only: performance terrible
- Razon: features tecnicos ya capturan el EFECTO de la noticia (gap, volume spike)

---

## 8. Problematicas Encontradas

### 8.1 Techo de AUC 0.76

Todos los modelos (LSTM, CNN-LSTM, GRU, Transformer, XGBoost, LightGBM) convergen al mismo AUC ~0.76 para predeccion de direccion en momentum stocks. Ni mas datos (8M rows vs 3M), ni mas features (86 vs 8), ni mejor arquitectura rompen este techo.

### 8.2 Focal Loss Causa Calibration Collapse

Focal Loss down-weights predicciones de alta confianza, causando que el modelo NUNCA produzca probabilidades > 0.65. Resultado: P@0.65+ = 0 senales. BCEWithLogitsLoss es la solucion correcta.

### 8.3 LSTM No Agrega Valor sobre Arboles

Raw features crudos (8 features por vela) dan el mismo P@threshold que 30 features pre-calculados. Razon: indicadores como RSI, ROC ya codifican el patron temporal. El LSTM es redundante cuando los features ya resumen la secuencia.

### 8.4 batch_size = 512 Era el Cuello de Botella

El batch grande promediaba gradientes sobre demasiadas muestras. Research valida 32-64 como optimo. 16x mas actualizaciones de gradiente por epoch.

### 8.5 num_workers = 4 Consumia 100GB de Disco

Para datasets de 2M secuencias, cada worker copia el dataset completo. Con 4 workers = 4 copias en RAM → macOS swappea a disco. Solucion: num_workers=0.

### 8.6 Grid vs Backtest Real

El grid reporta P@0.70 = 0.62 pero el backtest real da 31-35% WR. La diferencia es que el grid evalua en datos de test con distribucion favorable, mientras el backtest real tiene sesgo temporal y condiciones de mercado variables.

### 8.7 SPY Demasiado Eficiente

El modelo para SPY raramente produce probabilidades > 0.40 en inference real, a pesar de P@0.70 = 0.72 en el grid. SPY es el instrumento mas liquido y eficiente del mundo — miles de algos compiten por las mismas ineficiencias.

### 8.8 Noticias No Mejoran Nada

10 features de noticias (Alpaca News API historico, 800+ dias) no mejoran P@threshold. Los features tecnicos ya capturan el efecto: gap del premarket = noticia. Volume spike = actividad por noticia. El modelo ya "ve" la noticia a traves de sus efectos en el precio.

### 8.9 Predecir Direccion es el Problema Fundamental

- **Predecir que se va a mover: 85-100% accuracy** (vol expansion)
- **Predecir para donde: ~33% WR** (break-even con ratio 2:1)

Esto se mantuvo constante a traves de:
- 6+ arquitecturas de modelo
- 15+ feature sets
- 10+ targets
- 2 mercados (stocks + SPY)
- Reglas simples (VWAP + breakout) vs ML
- Modelo dual (vol + direccion)

---

## 9. Estrategia Dual-Model

### 9.1 Concepto

1. **Modelo 1 (vol_exp):** Predice si va a haber un movimiento grande (>= 2x ATR)
2. **Modelo 2 (rr10m_ge_2):** Predice si la direccion es favorable (R/R >= 2)
3. **Solo opera cuando AMBOS modelos dicen si**
4. **TP/SL dinamico basado en ATR** (2x ATR TP, 1x ATR SL)

### 9.2 Modos de Direccion

| Modo | Como decide la direccion | WR en backtest |
|------|-------------------------|----------------|
| `rr` | Modelo ML (XGBoost bin_rr10m_ge_2) | 31% |
| `vol_only` | Reglas: encima VWAP + buy pressure + green candle | 29% |
| `breakout` | Reglas: VWAP + (buy pressure OR break HOD) + confirmacion | 29% |

### 9.3 Resultados de Backtest (12 dias, Marzo 2026)

**Modo RR (threshold vol=0.85, rr=0.70, TP=4%, SL=2%):**
- Total: 58 senales, 18W / 36L, **WR = 31.0%** (break-even = 33.3%)
- Vol expansion accuracy: 84.5% (49/58 correctas)

### 9.4 Uso

```bash
# Backtest basico
npx ts-node src/scripts/backtest-simulator/main-dual.ts 2026-03-27 09:30 11:00

# Con parametros
DUAL_VOL_THRESHOLD=0.85 DUAL_RR_THRESHOLD=0.70 \
DUAL_RR_MODEL=XGBoost_V2_core_bin_rr10m_ge_2 \
DUAL_TP_PCT=4 DUAL_SL_PCT=2 \
npx ts-node src/scripts/backtest-simulator/main-dual.ts 2026-03-27 09:30 11:00

# Con filtros de noticias
DUAL_REQUIRE_CATALYST=true DUAL_NO_DILUTION=true \
npx ts-node src/scripts/backtest-simulator/main-dual.ts 2026-03-27 09:30 11:00
```

---

## 10. Infraestructura de Backtest

### 10.1 Backtest de Stocks (TypeScript, 3 fases)

**Fase 1 — Screener + Payloads:**
- Construye snapshots sinteticos de todas las acciones
- Corre el screener (5 rankings) cada 5 minutos
- Para cada simbolo activo: calcula indicadores y construye payload

**Fase 2 — Predicciones en Batch:**
- Spawns proceso Python con stdin/stdout
- Envia payloads en JSON, recibe probabilidades
- Soporta: predict_batch.py (arboles), predict_batch_sequence.py (LSTM), predict_batch_dual.py (dual)

**Fase 3 — Evaluacion de Trades:**
- Para cada senal tradeable: busca en candles futuras si TP o SL se pega primero
- Maneja gaps (gap up through TP, gap down through SL)
- Ambos en misma vela: green candle = SL first, red candle = TP first
- Look-ahead configurable (10-120 candles)

### 10.2 Backtest de SPY (Python)

Script mas simple: un solo simbolo, sin screener.
- Carga barras de `data/raw/{fecha}/bars-1m.json.gz`
- Incluye UVXY para features de VIX proxy
- Corre feature engineering + prediccion candle por candle
- Evalua TP/SL con look-ahead configurable
- Cooldown de 3 candles entre senales

```bash
python -m ml.backtest_spy --start 2026-03-01 --end 2026-03-27 --threshold 0.40 --tp 0.3 --sl 0.15 --look-ahead 30
```

---

## 11. Pipeline de Noticias

### 11.1 Descarga (download-news.ts)

```bash
npx tsx scripts/download-news.ts 2023-01-01 2026-03-27
```

- Descarga TODAS las noticias de cada dia de Alpaca News API
- 10 dias en paralelo (concurrency=10)
- Guarda en `trading-agent/data/{fecha}/news.json.gz`
- Campos: id, headline, created_at, symbols, source, summary
- Resumable: skipea fechas que ya tienen news.json.gz

### 11.2 Enriquecimiento (add-news-features.ts)

```bash
npx tsx scripts/add-news-features.ts data/training-v2-morning-full.csv
```

- Lee CSV linea por linea (streaming, no carga en memoria)
- Para cada fila: busca noticias del simbolo/fecha en news.json.gz
- Clasifica headlines con keyword matching (catalyst-classifier.ts)
- Sin future leakage: solo usa noticias publicadas ANTES del candle
- Output: `training-v2-morning-full-with-news.csv` con 10 columnas extra

---

## 12. Validacion Estadistica Final (CPCV)

### 12.1 Que es CPCV

Combinatorial Purged Cross-Validation (López de Prado, 2018):
- Divide datos en 10 grupos cronologicos
- Prueba cada combinacion de 2 grupos como test (45 paths)
- Purga filas de train que se solapan con test (embargo)
- Calibra probabilidades con Platt scaling
- Corrige por multiple testing con Deflated Sharpe Ratio

### 12.2 Resultados CPCV

| Modelo | Features | Target | P@0.70 (CPCV) | DSR p-value | Significativo? |
|--------|----------|--------|----------------|-------------|----------------|
| XGBoost | V2_full | **vol_exp_10m_2atr** | **0.849 ± 0.006** | **0.0000** | **SI** |
| LightGBM | V4_orderflow | bin_rr10m_ge_2 | 0.000 ± 0.000 | 0.0003 | (neg) |
| LightGBM | V2_full | bin_rr10m_ge_2 | 0.000 ± 0.000 | 0.0001 | (neg) |
| XGBoost | V2_full | bin_rr10m_ge_2 | 0.000 ± 0.000 | 0.0001 | (neg) |
| XGBoost | V2_core | bin_rr10m_ge_2 | 0.000 ± 0.000 | 0.0000 | (neg) |
| XGBoost | D_clean | bin_rr10m_ge_2 | 0.000 ± 0.000 | 0.0000 | (neg) |
| LightGBM | V2_full | bin_tb30m_tp3p0_sl1p5 | 0.000 ± 0.000 | 0.0414 | (neg) |
| XGBoost | V2_full | bin_tb30m_tp3p0_sl1p5 | 0.000 ± 0.000 | 0.0053 | (neg) |

### 12.3 Interpretacion

**Despues de calibrar probabilidades con Platt scaling, NINGUN modelo de direccion produce probabilidades > 0.70.** El grid anterior reportaba P@0.70 = 0.60+ porque las probabilidades estaban sin calibrar — el modelo decia 0.70 pero la probabilidad real era ~0.50.

Los modelos de direccion son "significativos" en DSR pero con Sharpe NEGATIVO — significativamente MALOS.

El unico resultado genuino es **volatility expansion** (P@0.70 = 0.849, DSR p=0.0000).

---

## 13. Straddle Backtest

### 13.1 Con Premium Fijo (irreal)
- thr=0.9, hz=30, cost=5%: **61.8% WR, +3.96% avg PnL** — parece excelente
- Pero el premium fijo no refleja la realidad (stocks volatiles tienen premiums caros)

### 13.2 Con Premium Dinamico (realista)
- Premium = ATR × sqrt(horizonte) × IV_multiplier
- iv_mult=1.0x (optimista): +0.01% a +0.23% avg PnL — **break-even**
- iv_mult=1.5x (realista): -1.4% a -2.5% — **pierde dinero**
- iv_mult=2.0x (conservador): -2.7% a -4.6% — **pierde mucho**

**El mercado de opciones ya sabe que estos stocks se van a mover y cobra por eso en el premium.**

---

## 14. HMM Regime Detection

### 14.1 Resultados
- 3 regimenes detectados: calm, normal, volatile
- Modelo combinado (con hmm_regime feature): P@0.70 = 0.681 (igual que sin HMM)
- Modelos per-regime: PEORES (menos data por modelo, pierde generalizacion)
- **Conclusion: regimenes no rompen el techo de direccion**

---

## 15. VPIN / Order Flow

### 15.1 Resultados
- VPIN con tick rule: P@0.70 = 0.428 (solo VPIN) a 0.682 (VPIN + V2_full)
- LightGBM V4_orderflow rr10m_ge_2: P@0.70 = 0.682 (mejor resultado de direccion pre-calibracion)
- **Post-calibracion (CPCV): P@0.70 = 0.000** — el tick rule no es order flow real

---

## 16. Conclusion Definitiva

### Lo unico que funciona (validado estadisticamente):
- **Predecir volatilidad** — P@0.70 = 0.849, DSR p=0.0000
- Pero no se puede monetizar sin:
  - Data real de opciones (IV, precios de calls/puts)
  - O datos de Level 2 / order flow para predecir direccion

### Todo lo demas es falso descubrimiento:
- Direccion con OHLCV: **imposible** (calibrado P@0.70 = 0)
- Noticias: zero improvement
- LSTM vs arboles: identicos
- HMM regimes: no improvement
- VPIN tick rule: no es order flow real
- Straddle: premium dinamico come toda la ganancia

### Para continuar se necesita:
1. **Real Level 2 / order flow data** (Interactive Brokers, no Alpaca)
2. **Real options IV data** (Alpaca tiene — `get_option_chain` con Greeks)
3. **Diferente approach**: mean-reversion, pairs trading, statistical arbitrage
4. **Diferente mercado**: crypto (menos eficiente), commodities

### Archivos Clave

```
stock-training/ml/experiments/
  feature_engineer.py        — 90+ features, 18 feature sets (incl V4_orderflow)
  target_variants.py         — 48+ targets (incl vol_exp)
  run_grid.py                — grid search arboles
  run_sequence_grid.py       — grid search LSTM
  run_regime_grid.py         — grid search con HMM regimes
  run_cpcv_validation.py     — validacion CPCV + DSR + calibracion
  regime_detection.py        — HMM fit/predict/label
  straddle_backtest.py       — straddle con premium dinamico
  train_best.py              — entrena mejores modelos
  predict_batch_dual.py      — prediccion dual-model
  models/lstm_momentum.py    — 5 arquitecturas PyTorch
  data_loader.py             — cpcv_split(), cluster_features()
  evaluator.py               — deflated_sharpe_ratio(), calibration_metrics()

sp500-prediction/ml/
  feature_engineer.py        — 50 features SPY
  target_variants.py         — 9 targets vol-scaled
  backtest_spy.py            — backtest SPY
  train_sequence.py          — LSTM training

trading-agent/src/scripts/backtest-simulator/
  main.ts                    — backtest principal (3 fases)
  main-dual.ts               — backtest dual-model
  trade-simulator.ts         — evaluacion TP/SL (con dynamic ATR)
  trade-filters.ts           — filtros + noticias
  predictor-client.ts        — bridge a Python
```
