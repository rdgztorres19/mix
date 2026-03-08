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
```bash
POST /predict?threshold=0.3
Content-Type: application/json

{
  "candle_idx": 1,
  "open": 5.2,
  "high": 5.5,
  "low": 5.1,
  "close": 5.4,
  "volume": 1000000,
  "atr": 0.15,
  "vwap": 5.3,
  "high_of_day": 5.6,
  "low_of_day": 5.0,
  "change_pct_at_candle": 2.5,
  "ema9": 5.25,
  "ema20": 5.2,
  "pre_market_high": 5.4,
  "shares_outstanding": 50000000,
  "market_cap": 270000000,
  "gap_pct": 5.0,
  "premarket_volume": 500000,
  "momentum_acumulado": 0.02,
  "change_1m": 0.5,
  "change_5m": 1.2,
  "change_10m": 2.0,
  "minutes_since_hod": 30
}
```

**Query params:** `threshold` (opcional, default 0.3 — recall ~91%). Valores más bajos = más señales, más falsas alarmas.

**Response:**
```json
{
  "tradeable": true,
  "prob": 0.4521,
  "threshold": 0.3
}
```

**Ejemplo con curl:**
```bash
curl -X POST http://localhost:3100/predict \
  -H "Content-Type: application/json" \
  -d '{"open":5.2,"high":5.5,"low":5.1,"close":5.4,"volume":1000000,"atr":0.15,"vwap":5.3}'
```

Las features que no envíes se rellenan con 0. Requiere que `stock-training` esté en `../stock-training` (o `STOCK_TRAINING_PATH` en `.env`).

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
