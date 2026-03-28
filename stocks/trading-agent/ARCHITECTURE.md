# Trading Agent — Arquitectura de Módulos

## Vista general

```
┌─────────────────────────────────────────────────────────────────────┐
│                           AppModule                                 │
│                                                                     │
│  ┌──────────┐  ┌───────────┐  ┌────────────┐  ┌─────────────────┐  │
│  │ Screener │  │ Collector │  │  Predictor  │  │     Trader      │  │
│  │ Module   │◄─│  Module   │──│   Module    │◄─│     Module      │  │
│  └────┬─────┘  └─────┬─────┘  └────────────┘  └─────────────────┘  │
│       │              │                                               │
│       │        ┌─────┴──────┐                                       │
│       │        │ WebSocket  │                                       │
│       │        │  Module    │                                       │
│       │        └────────────┘                                       │
│       │                                                             │
│  ┌────┴─────┐  ┌──────────┐                                        │
│  │ Scanner  │  │  Cache    │                                        │
│  │ Module   │  │  Module   │                                        │
│  └──────────┘  └──────────┘                                        │
└─────────────────────────────────────────────────────────────────────┘
```

**Dependencias entre módulos:**

| Módulo | Importa |
|--------|---------|
| **CollectorModule** | ScannerModule, ScreenerModule, TraderModule, WebSocketModule (forwardRef) |
| **TraderModule** | ScannerModule, PredictorModule, CacheModule |
| **WebSocketModule** | ScannerModule, CollectorModule (forwardRef) |
| **ScreenerModule** | CacheModule |
| **PredictorModule** | ScannerModule |

---

## 1. Screener Module

**Propósito:** Escanea el universo de ~5000+ acciones US equity cada minuto, rankea por diferentes criterios, y produce una lista "combined" de los ~40 mejores símbolos para trading.

### Flujo principal

```
Cron cada 1 min (09:00–12:59 ET)
  │
  ▼
RankingService.syncAllRankings()
  │
  ├─ 1. AssetsService.getAllSymbols() → universo filtrado de screener_assets
  │
  ├─ 2. ensurePrevCloseCache() → prev_close de DB + backfill desde Alpaca daily bars
  │
  ├─ 3. mergeSnapshots(universe) → fetch snapshots de Alpaca en chunks (PromisePool)
  │     Endpoint: GET /v2/stocks/snapshots?symbols=AAPL,TSLA,...
  │     Retorna: dailyBar (OHLCV del día), prevDailyBar, latestTrade
  │
  ├─ 4. Ejecuta 5 rankings (funciones puras):
  │     ├─ rankTopGappers()        → gap% = (open - prevClose) / prevClose
  │     ├─ rankTopGainersSession() → gain% = (close - prevClose) / prevClose
  │     ├─ rankTopGainersIntraday()→ gain% usando latestTrade.price
  │     ├─ rankTopHighSession()    → high% = (dayHigh - prevClose) / prevClose
  │     └─ rankTopHighCurrent()    → high% usando max(dayHigh, latestTrade)
  │     Cada una filtra por minVolume (env SCREENER_VOLUMEN_REQUIRED, default 500k)
  │     y retorna top N (env SCREENER_TOP_N, default 40) ordenados por métrica
  │
  ├─ 5. Persiste en MySQL: screener_rank_rows (DELETE + INSERT por tipo)
  │
  ├─ 6. ActiveSymbolsService.rebuildFromStoredRanks()
  │     Merge top N de cada categoría → dedup por símbolo → score = max(metric)
  │     → top 40 global → screener_active_symbols
  │
  ├─ 7. Cache en Redis (7 días TTL):
  │     screener:{type}:{date} → cada ranking
  │     screener:combined:{date} → lista combinada
  │
  └─ 8. Persiste quote snapshots + actualiza screener_run_meta
```

### Crons

| Schedule | Método | Qué hace |
|----------|--------|----------|
| `*/1 * * * *` (cada minuto) | `ScreenerCron.marketTick()` | Si es weekday + 09:00–12:59 ET → `syncAllRankings()` (rankings + quotes) |
| `0 * * * *` (cada hora :00) | `ScreenerCron.postMarketHourly()` | Si es weekday + 16:00–20:00 ET → `refreshQuoteCacheOnly()` (solo quotes, sin recalcular rankings) |

### onModuleInit

| Servicio | Qué hace |
|----------|----------|
| `AssetsService` | Asegura tablas MySQL. Si `screener_assets` está vacía, descarga todo el universo de Alpaca (`GET /v2/assets`) filtrado por env flags y lo persiste |

### Endpoints HTTP

| Ruta | Método | Retorna |
|------|--------|---------|
| `GET /screener/gappers` | getGappers | Top gappers del día |
| `GET /screener/gainers` | getGainers | Gainers session + intraday |
| `GET /screener/gainers/session` | getGainersSession | Solo gainers por sesión |
| `GET /screener/highs` | getHighs | High of day (session + current) |
| `GET /screener/combined` | getCombined | Lista combinada (los ~40 símbolos) |
| `GET /screener/active` | getActive | Combined con rank_order y score |
| `GET /screener/status` | getStatus | Última corrida, fecha, # símbolos |
| `POST /screener/force-sync` | forceSync | Fuerza recálculo inmediato de rankings |

### Tablas MySQL

| Tabla | Propósito |
|-------|-----------|
| `screener_assets` | Universo de activos (descargado de Alpaca) |
| `screener_prev_close` | Cierre previo por símbolo (para calcular gap%) |
| `screener_quote_snapshot` | Último precio, high, low, volume por símbolo |
| `screener_rank_rows` | Rankings por tipo (gapper, gainer_session, etc.) |
| `screener_active_symbols` | Lista combinada final con score |
| `screener_run_meta` | Metadata de la última corrida |

### Redis keys

| Key | Contenido | TTL |
|-----|-----------|-----|
| `screener:{type}:{YYYY-MM-DD}` | JSON con rows del ranking | 7 días |
| `screener:combined:{YYYY-MM-DD}` | JSON con símbolos combinados + score | 7 días |

---

## 2. Collector Module

**Propósito:** Orquestador central. Recibe la lista del Screener, backfill candles de Alpaca, procesa velas en real-time, calcula indicadores, persiste en MySQL, y delega al Trader para predicción/trading.

### Flujo principal

```
                    ┌──────────────────────────┐
                    │   CollectorCron           │
                    │   (cada 1 min 9-16 ET)    │
                    └─────────┬────────────────┘
                              │
                              ▼
                    runTopGainersCron()
                              │
  ┌───────────────────────────┼──────────────────────────┐
  │                           │                          │
  ▼                           ▼                          ▼
TopGainersSource       replaceActiveSymbols()      persistActiveSymbols()
 .fetchSymbols()       (reemplaza el Set de         (guarda en MySQL)
  │                     símbolos para trading)
  │ source=internal
  ▼
ScreenerService
 .getCombinedSymbols() ← los ~40 del combined
  │
  ▼
backfillNewSymbols()
  │ (solo los nuevos que no están en memoria)
  ▼
addSymbolsBulk() [PromisePool, concurrency 15]
  │
  ├─ fetchAndBuildCandles(symbol, today)
  │   ├─ Alpaca REST: fetch 1m bars del día
  │   ├─ Alpaca REST: fetch prev day close
  │   ├─ buildMetadata (gap%, premarket high, fundamentals)
  │   ├─ buildTrainingRows (VWAP, EMA, ATR, etc.)
  │   └─ MySQL: bulk upsert training rows
  │
  └─ symbols Map ← guardar estado en memoria
```

### Real-time candle processing

```
Alpaca WebSocket (wss://stream.data.alpaca.markets/v2/sip)
  │
  ▼
AlpacaWebSocketService.onBar()
  │
  ▼
WebSocketInitService → collector.onCandleClosed(symbol, candle)
  │
  ├─ Actualiza history[] del símbolo en memoria
  ├─ computeCandleRow() → indicadores (VWAP, EMA9, EMA20, ATR, HOD, LOD, etc.)
  ├─ MySQL upsert (training_1m)
  ├─ Socket.IO → UI (candle:update)
  │
  └─ if activeSymbols.has(symbol):
       └─ autoTrader.onCandleClosed(row) → ver Trader Module
```

### Crons

| Schedule | Método | Qué hace |
|----------|--------|----------|
| `0 * 9-16 * * 1-5` (cada min, 9-16 ET, L-V) | `CollectorCron.runTopGainersCron()` | Fetch top gainers → reemplazar activeSymbols → backfill nuevos → refresh WS |

### onModuleInit

| Servicio | Qué hace |
|----------|----------|
| `CollectorService` | 1) Resuelve WebSocketInitService via ModuleRef. 2) Asegura tabla MySQL. 3) `reloadMissingSymbolsFromDb()` (time-gated 4AM-12PM ET): restaura símbolos de la sesión anterior. 4) Espera 3s. 5) Suscribe todos los símbolos al WS de Alpaca |
| `CollectorCron` | Ejecuta `runTopGainersCron()` inmediatamente al startup |
| `ScannedTrackerService` | Asegura tabla MySQL + carga símbolos tracked de hoy |

### Wiring circular: Collector ↔ WebSocket

```
CollectorModule imports forwardRef(() => WebSocketModule)
WebSocketModule imports forwardRef(() => CollectorModule)

CollectorService → resuelve WebSocketInitService via ModuleRef (lazy)
WebSocketInitService → inyecta CollectorService via forwardRef
```

### Wiring: Collector → AutoTrader

```
CollectorModule imports TraderModule
CollectorService recibe @Optional() AutoTraderService en constructor
  → en constructor: autoTrader.setGateway(this.gateway)
    (le pasa el CollectorGateway para que pueda emitir al UI)
```

### Endpoints HTTP

| Ruta | Método | Qué hace |
|------|--------|----------|
| `POST /collector/sync-symbol-date` | syncSymbolDate | Backfill 1 símbolo + fecha desde Alpaca |
| `POST /collector/sync-date` | syncDate | Re-sync todos los símbolos de una fecha |
| `POST /collector/sync-today` | syncToday | Fetch top gainers + sync cada uno |
| `POST /collector/force-resync` | forceResync | Re-suscribir todos al WS de Alpaca |
| `POST /collector/features/today-candles` | getTodayCandleFeatures | Extraer features sin escribir a DB |
| `GET /collector/status` | getStatus | Símbolos activos, WS status |
| `GET /collector/debug-streams` | getStreamStatus | Estado de Alpaca WS + posiciones abiertas |
| `GET /scanner-tracker/today` | getTrackedSymbolsToday | Símbolos tracked hoy con float/catalyst |

### Socket.IO events (namespace: /collector)

| Evento | Cuándo se emite | Payload |
|--------|-----------------|---------|
| `candle:update` | Cada vela cerrada | symbol, OHLCV, indicadores, timestamps |
| `candle:live` | Tick en progreso | symbol, OHLCV lightweight |
| `symbols:update` | Cambio de watchlist | string[] de símbolos |
| `predict:signal` | Después de predict | symbol, prob, threshold, tradeable |
| `trade:entry` | Compra ejecutada | symbol, price, qty, orderId |
| `trade:exit` | Venta ejecutada | symbol, entryPrice, exitPrice, pnl |

### Scanned Tracker (sub-módulo)

Tracking enriquecido de cada símbolo que entra al scanner:

```
Nuevo símbolo detectado
  │
  ├─ FMP API → float shares, outstanding shares
  ├─ Yahoo/Finviz News → headlines → score catalyst (strength + type)
  └─ Persiste en MySQL

Cron cada 1 min (4AM-12PM ET, L-V):
  │
  └─ Por cada símbolo tracked:
       ├─ Fetch Alpaca REST → premarket volume, dollar volume
       ├─ Calcular EMA9, gap%, close
       ├─ Pre-filter: premarketDollarVolume ≤ threshold AND close > EMA9
       └─ Update en DB
```

---

## 3. Predictor Module

**Propósito:** Interfaz con el modelo de ML (Python). Hace predict individual y batch, backtest con TP/SL, evaluación de métricas.

### Cómo funciona la predicción

```
AutoTrader pide predict:
  │
  ▼
PredictorService.predict({ ticker, date, candle_time_et }, threshold)
  │
  ├─ Modo histórico (tiene ticker+date+time):
  │   → Busca candles en MySQL (training_1m)
  │   → Construye payload con candles + features
  │
  └─ Spawn: python3 predict_batch.py
       │ stdin: JSON con payloads
       │ stdout: JSON con resultados [{prob, tradeable}]
       │
       │ Python internamente:
       │ ├─ Carga modelo RandomForest serializado
       │ ├─ Extrae features del payload
       │ ├─ model.predict_proba() → probabilidad
       │ └─ tradeable = prob >= threshold
       │
       ▼
  PredictResult { prob: 0.72, tradeable: true, threshold: 0.65 }
```

### Backtest

```
PredictorService.backtestStreamDay(date, fromTime, toTime, threshold, ...)
  │
  ├─ Obtiene símbolos (override o getTopMovers de MySQL)
  ├─ Por cada símbolo, por cada minuto en el rango:
  │   ├─ callPredictBatch() → prob
  │   ├─ Si prob >= threshold:
  │   │   └─ computeTpSlExit() → simula TP/SL con look-ahead de N velas
  │   │       ├─ levelUp = close * (1 + tpPct)
  │   │       ├─ levelDown = close * (1 - slPct)
  │   │       └─ Itera velas futuras buscando hit TP, SL, o timeout
  │   └─ Emite resultado via SSE stream
  │
  └─ Emite summary: TP/FP/TN/FN, precision, recall, accuracy, PnL total
```

### Env vars

| Variable | Default | Uso |
|----------|---------|-----|
| `STOCK_TRAINING_PATH` | `../stock-training` | Ruta al repo de Python con modelos y scripts |

### Endpoints HTTP

| Ruta | Qué hace |
|------|----------|
| `POST /predictor/predict` | Predicción individual |
| `POST /predictor/evaluate` | Métricas del modelo (precision, recall, etc.) |
| `GET /predictor/backtest` | SSE stream de backtest por símbolo |
| `GET /predictor/backtest-day` | SSE stream de backtest multi-símbolo |
| `GET /predictor/backtest-candles` | Candles desde punto de entrada |

---

## 4. Trader Module

**Propósito:** Ejecuta trades reales en Alpaca Paper/Live. Gestiona posiciones abiertas, auto-entry/exit basado en señales del predictor.

### Flujo de un trade completo

```
onCandleClosed(row) ← llamado por CollectorService
  │
  ├─ ¿Posición abierta para este símbolo?
  │   │
  │   ├─ SÍ → trackOpenPosition()
  │   │   ├─ incrementCandles() → candles_elapsed++
  │   │   └─ if candles_elapsed >= EXIT_CANDLES (default 10):
  │   │       ├─ alpaca.sellMarket(symbol, qty)
  │   │       ├─ positionTracker.closePosition() → PnL = (exit - entry) * qty
  │   │       ├─ gateway.emitTradeExit() → UI
  │   │       └─ Log: "EXITED AAPL: $15.20 | PnL=$3.40 after 10 candles"
  │   │
  │   └─ NO → evaluateAndTrade()
  │       ├─ predictor.predict(row) → { prob: 0.72, tradeable: true }
  │       ├─ gateway.emitPredictSignal() → UI
  │       │
  │       ├─ ¿Entrar al trade?
  │       │   Checks: tradeable + AUTO_TRADE_ENABLED + alpaca.isEnabled()
  │       │
  │       └─ SÍ → buyAndTrack()
  │           ├─ calculatePositionSize() → equity * AUTO_TRADE_PCT (1%)
  │           ├─ alpaca.buyBracketLimit(symbol, dollarAmount, close)
  │           │   ├─ Limit entry: close * 1.02 (2% aggressive)
  │           │   ├─ Take Profit: entry * 1.04 (4%)
  │           │   ├─ Stop Loss: entry * 0.98 (2%)
  │           │   └─ Auto-cancel si no llena en 30s
  │           ├─ positionTracker.openPosition() → MySQL auto_positions
  │           ├─ storeTradeRowByDay() → Redis (7 días TTL)
  │           ├─ gateway.emitTradeEntry() → UI
  │           └─ Desktop notification (node-notifier)
```

### AlpacaTraderService — Bracket Order detalle

```
buyBracketLimit(symbol, $500, lastPrice=$10.00):
  │
  ├─ entryLimit = $10.00 * 1.02 = $10.20  (limit agresivo)
  ├─ qty = floor($500 / $10.20) = 49 shares
  ├─ takeProfit = $10.20 * 1.04 = $10.608
  ├─ stopLoss = $10.20 * 0.98 = $9.996
  │
  ├─ POST /v2/orders:
  │   { order_class: "bracket", side: "buy", type: "limit",
  │     limit_price: "10.20", qty: "49", time_in_force: "day",
  │     take_profit: { limit_price: "10.61" },
  │     stop_loss: { stop_price: "10.00" } }
  │
  └─ setTimeout(30s): si no se llenó → cancelOrder()
```

### PositionTrackerService — Persistencia

```
MySQL: auto_positions
  │
  ├─ onModuleInit():
  │   ├─ CREATE TABLE IF NOT EXISTS auto_positions (...)
  │   ├─ ALTER TABLE ADD metadata JSON (migración)
  │   └─ SELECT * WHERE status='open' → restaurar en memoria
  │
  ├─ openPosition():
  │   └─ INSERT → Map.set(symbol, position)
  │
  ├─ incrementCandles():
  │   └─ UPDATE candles_elapsed → Map update
  │
  └─ closePosition():
      └─ UPDATE status='closed', exit_price, pnl → Map.delete(symbol)
```

### Env vars

| Variable | Default | Uso |
|----------|---------|-----|
| `AUTO_PREDICT_ENABLED` | `false` | Habilita predicciones automáticas |
| `AUTO_TRADE_ENABLED` | `false` | Habilita ejecución real de trades |
| `AUTO_PREDICT_THRESHOLD` | `0.70` | Probabilidad mínima para señal de compra |
| `AUTO_TRADE_PCT` | `0.01` | % del equity por trade (1%) |
| `AUTO_TRADE_EXIT_CANDLES` | `10` | Velas antes de auto-sell |
| `ALPACA_PAPER_BASE_URL` | `https://paper-api.alpaca.markets/v2` | Base URL de Alpaca |
| `ALPACA_PAPER_KEY_ID` | — | API key para trading |
| `ALPACA_PAPER_SECRET_KEY` | — | API secret para trading |

### Tablas MySQL

| Tabla | Columnas clave | Propósito |
|-------|---------------|-----------|
| `auto_positions` | id, symbol, entry_price, qty, candles_elapsed, exit_price, pnl, status, alpaca_order_id, metadata JSON | Posiciones abiertas/cerradas |

### Redis keys

| Key | Contenido | TTL |
|-----|-----------|-----|
| `autotrader:entries:rows:{YYYY-MM-DD}` | Lista de CandleRow JSON por cada trade ejecutado | 7 días |

---

## 5. WebSocket Module

**Propósito:** Bridge entre Alpaca real-time stream y el CollectorService. Gestiona conexión, reconexión, suscripciones dinámicas, y fallback a REST.

### Flujo de conexión

```
onModuleInit():
  │
  ├─ AlpacaWebSocketService.connect()
  │   └─ new WebSocket('wss://stream.data.alpaca.markets/v2/sip')
  │       ├─ onOpen → send auth { ALPACA_KEY_ID, ALPACA_SECRET_KEY }
  │       ├─ onMessage(T='success') → authenticated!
  │       │   ├─ Resets reconnect counter
  │       │   ├─ Starts ping interval (30s)
  │       │   ├─ Re-subscribe to symbols from before disconnect
  │       │   └─ Fire authCallbacks:
  │       │       └─ WebSocketInitService.onAuthenticated():
  │       │           ├─ collector.reloadMissingSymbolsFromDb() (time-gated)
  │       │           └─ refreshSubscriptions(symbols)
  │       │
  │       ├─ onMessage(T='b') → bar received
  │       │   └─ barCallbacks → WebSocketInitService:
  │       │       └─ collector.onCandleClosed(symbol, candle)
  │       │
  │       ├─ onClose → save subscriptions, scheduleReconnect()
  │       │   └─ Exponential backoff: 5s, 7.5s, 11.25s ... max 60s
  │       │
  │       └─ onError → terminate + scheduleReconnect()
  │
  └─ WebSocketInitService registra callbacks y espera 2s
```

### Fallback Cron

```
@Cron('1,5 * 4-14 * * *')  → segundo 1 y 5 de cada minuto, 4AM-2PM ET
  │
  ├─ ¿WS desconectado?
  │   └─ SÍ → triggerReconnect + fetch REST para todos los símbolos
  │
  └─ ¿WS conectado?
      └─ Por cada símbolo:
          ├─ Verificar lastBarTime vs expectedBarTime (tolerancia 30s)
          └─ Si falta data → fetchFallbackData via Alpaca REST
              └─ collector.onCandleClosed(symbol, candle)
```

### Env vars

| Variable | Default | Uso |
|----------|---------|-----|
| `ALPACA_KEY_ID` | — | Key para data WS (SIP feed) |
| `ALPACA_SECRET_KEY` | — | Secret para data WS |
| `ALPACA_WEBSOCKET_ENABLED` | `true` | Habilita WS connection |
| `ALPACA_RECONNECT_INTERVAL_MS` | `5000` | Base interval de reconexión |
| `WEBSOCKET_FALLBACK_ENABLED` | `true` | Habilita fallback REST cron |

---

## 6. Cache Module

**Propósito:** Redis client compartido entre módulos.

### Servicios

| Servicio | Qué hace |
|----------|----------|
| `RedisClientService` | Wrapper de ioredis. Expone `getClient()` que retorna la instancia Redis |
| `NewsCacheService` | Cache de noticias (usado por ScannedTracker) |

### Quién lo usa

- **TraderModule** → `AutoTraderService` guarda trade rows en Redis
- **ScreenerModule** → `RankingService` cachea rankings en Redis

---

## Flujo completo: De 0 a trade

```
1. APP STARTS
   ├─ AssetsService.onModuleInit() → descarga universo si vacío
   ├─ PositionTrackerService.onModuleInit() → restaura posiciones abiertas
   ├─ CollectorService.onModuleInit() → restaura símbolos (4AM-12PM)
   ├─ WebSocketInitService.onModuleInit() → conecta Alpaca WS
   │   └─ onAuthenticated → reloadMissingSymbols + subscribe
   └─ CollectorCron.onModuleInit() → primer runTopGainersCron()

2. CADA MINUTO (9:00-12:59 ET)
   ├─ ScreenerCron → syncAllRankings()
   │   └─ Fetch snapshots → 5 rankings → combined list → Redis
   │
   └─ CollectorCron → runTopGainersCron()
       ├─ TopGainersSource.fetchFromInternalScreener()
       │   └─ screenerService.getCombinedSymbols() ← los ~40 del step anterior
       ├─ Reemplaza activeSymbols con estos ~40
       ├─ Backfill nuevos símbolos (Alpaca REST 1m bars)
       └─ Refresh WS subscriptions

3. CADA VELA CERRADA (real-time)
   Alpaca WS → WebSocketInitService → collector.onCandleClosed()
   ├─ Computa indicadores
   ├─ Persiste en MySQL
   ├─ Emite al UI
   └─ if activeSymbol → autoTrader.onCandleClosed()
       ├─ predict → prob
       ├─ if prob >= threshold → bracket buy
       └─ if posición abierta >= 10 velas → sell

4. AFTER HOURS (16:00-20:00 ET)
   └─ ScreenerCron.postMarketHourly() → solo refresh quotes (sin rankings)
```

---

## Env vars completas

```bash
# ── Alpaca Market Data (SIP feed, real-time + REST) ──
ALPACA_KEY_ID=
ALPACA_SECRET_KEY=

# ── Alpaca Paper Trading ──
ALPACA_PAPER_BASE_URL=https://paper-api.alpaca.markets/v2
ALPACA_PAPER_KEY_ID=
ALPACA_PAPER_SECRET_KEY=

# ── Auto-Trading ──
AUTO_PREDICT_ENABLED=false
AUTO_TRADE_ENABLED=false
AUTO_PREDICT_THRESHOLD=0.70
AUTO_TRADE_PCT=0.01
AUTO_TRADE_EXIT_CANDLES=10

# ── Screener ──
TOP_GAINERS_SOURCE=internal          # internal | hpg | alpaca_screener
SCREENER_TOP_N=40
SCREENER_VOLUMEN_REQUIRED=500000
SCREENER_CHUNK_SIZE=1000
SCREENER_CHUNK_CONCURRENCY=5
SCREENER_DB_BATCH_SIZE=500
SCREENER_MAX_RETRIES=20

# ── WebSocket ──
ALPACA_WEBSOCKET_ENABLED=true
ALPACA_RECONNECT_INTERVAL_MS=5000
WEBSOCKET_FALLBACK_ENABLED=true

# ── ML Model ──
STOCK_TRAINING_PATH=../stock-training

# ── MySQL ──
MYSQL_HOST=
MYSQL_PORT=3306
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE_TRAINING=

# ── Redis ──
REDIS_URL=redis://localhost:6379

# ── External APIs ──
FMP_API_KEY=                          # Financial Modeling Prep (float data)
```
