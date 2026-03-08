# Stock Training — Dataset Builder for LLM/Descriptive Models

Genera un CSV de entrenamiento a partir de [top_gainers.json](https://www.historicalpercentgainers.com/static/top_gainers.json) con datos históricos 1-min, indicadores técnicos, sesión y clasificación de catalizadores.

## Estructura

```
stock-training/
  data/
    top_gainers.json    # Descargar desde historicalpercentgainers.com
    training.csv        # Output del script
  src/
    types.ts
    indicators/         # VWAP, EMA, ATR
    data/               # historical-fetcher, news-fetcher
    catalyst/           # catalyst-classifier (buyout, split, etc.)
    session/            # session-utils (PRE_MARKET, THE_OPEN, etc.)
  scripts/
    build-training-csv.ts
```

## Paso 1: Descargar top_gainers.json

```bash
curl -o data/top_gainers.json https://www.historicalpercentgainers.com/static/top_gainers.json
```

O ejecutar `npm run fetch-top-gainers`.

## Paso 2: Generar CSV de entrenamiento

```bash
npm install
npm run build:csv -- --limit 20 --output data/training.csv
```

### Columnas del CSV

| Columna | Descripción |
|---------|-------------|
| symbol | Ticker |
| date | Fecha YYYY-MM-DD |
| candle_time_et | Hora de la vela (ET) |
| candle_idx | Índice de la vela |
| open, high, low, close, volume | OHLCV |
| atr | ATR 14 |
| vwap | VWAP hasta ese momento |
| high_of_day, low_of_day | HOD/LOD |
| change_pct_at_candle | Cambio % vs cierre previo |
| ema9, ema20 | EMAs |
| pre_market_high | Máximo pre-market |
| session | PRE_MARKET, THE_OPEN, LATE_MORNING, MIDDAY, THE_CLOSE, AFTER_HOURS |
| had_news | Si hubo noticia ese día |
| catalyst_category | BUYOUT_ACQUISITION_MERGER, FDA_APPROVAL, SPLIT, etc. |
| catalyst_strength | STRONG, MODERATE, WEAK, NONE |
| catalyst_is_dilutive | Si es oferta/dilución |

## Fuentes de datos

- **1-min histórico**: Momoscreener (reciente) o Polygon.io (histórico con `POLYGON_API_KEY`)
- **Noticias**: Yahoo Finance (recientes; para histórico exacto considerar NewsAPI/Benzinga)

## Variables de entorno

```env
MOMO_BASE_URL=https://momoscreener.com/api/p
POLYGON_API_KEY=   # Opcional, para datos 1-min históricos
OPENAI_API_KEY=   # Opcional, para clasificación LLM de noticias
MYSQL_HOST=localhost
MYSQL_USER=root
MYSQL_PASSWORD=...
MYSQL_DATABASE=stock_training
```

## Recalcular target con nuevo umbral

Sin re-descargar datos: lee `training.csv`, recalcula la columna `target` (1 si `future_return_5m > umbral`, 0 si no) y escribe un **nuevo CSV**. Procesa fila por fila sin mezclar tickers.

```bash
npm run recompute-target -- [--threshold 0.025] [--output data/training-2p5.csv]
```

Ejemplo (umbral 2.5%, salida por defecto `data/training-2p5.csv`):

```bash
npm run recompute-target -- --threshold 0.025
```

Luego: actualiza `ml/config.py` para usar el nuevo CSV, ejecuta `npm run sync-mysql` (copiando el nuevo CSV a `training.csv` o ajustando sync) y reentrena con `cd ml && python -m random_forest.train`.

## Recalcular target con nuevo umbral

Sin re-descargar datos: lee `training.csv`, recalcula la columna `target` con un nuevo umbral y escribe un CSV nuevo. Procesa fila por fila sin mezclar tickers.

```bash
npm run recompute-target -- [--threshold 0.025] [--output data/training-2p5.csv]
```

Por defecto: umbral 2.5%, salida `data/training-2p5.csv`. Luego: `npm run sync-mysql` (apuntando al nuevo CSV si quieres) y reentrenar el modelo.

## Recalcular target con nuevo umbral

Sin re-descargar datos: lee `training.csv`, recalcula la columna `target` con un nuevo umbral y escribe un nuevo CSV. Procesa fila por fila sin mezclar tickers.

```bash
npm run recompute-target -- [--threshold 0.025] [--output data/training-2p5.csv]
```

Por defecto: umbral 2.5%, salida `data/training-2p5.csv`. Luego: `npm run sync-mysql` (apuntando al nuevo CSV si lo sustituyes) y `cd ml && python -m random_forest.train`.

## Añadir nuevas features al CSV

Lee `training.csv` o `training-2p5.csv`, añade features derivadas y escribe `training-enriched.csv`:

- **volume_rel**: volume / avg(volume) por symbol+date
- **dist_vwap_pct**: (close - vwap) / vwap * 100
- **atr_rel**: atr / close * 100 (volatilidad normalizada)
- **volume_pm_ratio**: volume / premarket_volume
- **minute_of_day**: HH*60+MM desde candle_time_et

```bash
npm run add-features
# o con rutas explícitas:
npm run add-features -- --input data/training-2p5.csv --output data/training-enriched.csv
```

`ml/config.py` ya apunta a `training-enriched.csv`. Tras ejecutar add-features: `npm run sync-mysql` y `cd ml && python -m xgb.train`.

## Verificar predicciones vela por vela

Para comprobar las predicciones del modelo RF sobre datos de MySQL (ticker + fecha):

```bash
npm run verify-predictions -- TICKER FECHA [--threshold 0.6]

npm run verify-predictions -- TPET 2026-03-05
npm run verify-predictions -- GME 2025-01-10 --threshold 0.55
```

Ejemplo:

```bash
npm run verify-predictions -- SOUN 2025-01-15 --threshold 0.55
```

Requiere: MySQL con datos (`npm run sync-mysql`) y modelo entrenado (`cd ml && python -m random_forest.train`).


npm run build-training
npm run recompute-target
npm run add-features
cd ml && python -m xgb.train
cd ml && python -m xgb.evaluate
npm run sync-mysql
npm run ui
npm run verify-predictions