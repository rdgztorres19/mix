# AI Trading Assistant – Plan de Implementación

## Diagnóstico del Conocimiento

Tu `knowledge.txt` contiene:
- **Estrategias completas** (Bull Flag, ABCD, ORB, VWAP Reversal, Fallen Angel, etc.)
- **Reglas de entrada/salida** muy concretas (hotkeys, share sizing, stop loss formulas)
- **Criterios de selección de stocks** (float, volumen relativo, ATR, precio)
- **Psicología y disciplina** (cuando parar, FOMO, averaging down)
- **Lectura de Level 2 / DOM / Time & Sales**

---

## Comparativa de Enfoques AI

| Enfoque | Qué hace | ¿Aplica aquí? | Veredicto |
|---|---|---|---|
| **RAG** | Recupera texto relevante de tu doc para responder preguntas | ✅ Sí | Excelente como base |
| **Fine-tuning** | Entrena un modelo con tus datos | ⚠️ Parcial | No tiene suficientes datos de trades reales |
| **Reglas estrictas** | `if condición then acción` sin AI | ✅ Sí | Ideal para filtros de scanner |
| **Agente AI** | Combina todo + toma decisiones encadenadas | ✅ Sí | El objetivo final |
| **AI de predicción de precios** | Predice precio futuro | ❌ No | Ineficaz, mercado es ruidoso |

---

## Arquitectura Recomendada: Agente AI Híbrido

```
┌─────────────────────────────────────────────────────────┐
│                    AGENTE DE TRADING                     │
├──────────────┬──────────────────┬───────────────────────┤
│  CAPA 1      │    CAPA 2        │    CAPA 3             │
│  Scanner     │    RAG Engine    │    Decision Agent      │
│  (Reglas)    │    (Tu knowledge)│    (LLM + contexto)   │
└──────────────┴──────────────────┴───────────────────────┘
```

### Capa 1 – Scanner con Reglas (sin AI, determinista)

**Objetivo:** Filtrar el universo de stocks en tiempo real.

```javascript
const filtros = {
  precio: { min: 2, max: 20 },
  cambio_pct_hoy: { min: 10 },           // +10% vs close anterior
  volumen_relativo: { min: 5 },           // 5x el promedio
  float: { max: 20_000_000 },             // < 20M shares
  atr: { min: 0.50 },                     // al menos 50 cents de rango
  volumen_premarket: { min: 100_000 }
}
```

**Output:** Lista de 3–5 "Stocks in Play" con sus niveles clave pre-calculados.

---

### Capa 2 – RAG Engine (tu conocimiento)

**Objetivo:** Dado un stock y su chart data, recuperar qué estrategia aplica y cómo operarla.

**Cómo funciona:**
1. Se hace embedding del `knowledge.txt` en vectores (OpenAI embeddings o local con Ollama)
2. En tiempo real, se pasa el contexto del stock: precio, VWAP, EMAs, volumen, hora del día
3. El RAG recupera la sección relevante de tu doc

**Ejemplo de query al RAG:**
```
"Stock NVDA: precio $18.50, por encima de VWAP, consolidando 3 velas rojas 
después de spike, 9 EMA en $18.20, hora 9:45am, volumen 8x promedio. 
¿Qué estrategia aplica y cómo la opero?"
```

**Output esperado del RAG:**
> "Aplica **Bull Flag**. Espera primera vela que haga nuevo high. Entry en breakout 
> del flag, stop en low de la vela de consolidación ($18.15), target high of day. 
> Vende mitad al nuevo high, mueve stop a break-even."

---

### Capa 3 – Agente de Decisión (LLM + contexto live)

**Objetivo:** Generar una recomendación estructurada de operación en cada momento.

**Input al agente:**
```json
{
  "stock": "NVDA",
  "precio_actual": 18.50,
  "vwap": 18.10,
  "ema9": 18.20,
  "ema20": 18.00,
  "volumen_relativo": 8.2,
  "hora": "09:45",
  "velas_5min": [...],
  "nivel_premarket_high": 18.75,
  "nivel_premarket_low": 17.90,
  "estrategia_recuperada_rag": "Bull Flag"
}
```

**Output del agente:**
```json
{
  "decision": "PREPARAR_ENTRADA",
  "estrategia": "Bull Flag",
  "entry": 18.55,
  "stop": 18.15,
  "target_1": 18.75,
  "target_2": 19.00,
  "share_size": 200,
  "riesgo_total": 80,
  "ratio_rr": 2.5,
  "justificacion": "Consolidación sobre 9 EMA con volumen decreciendo en velas rojas. Hora óptima (The Open). Esperar primera vela verde que rompa high del flag.",
  "alertas": ["No entrar si rompe por debajo de $18.15 antes del breakout"]
}
```

---

## Plan de Construcción por Fases

### Fase 1 – RAG Básico (semana 1–2)
**Lo que construyes:**

```
knowledge.txt → embeddings → vector DB (chroma/pinecone/local)
                                    ↓
                    chat: "¿Cómo opero un Bull Flag a las 10am?"
                                    ↓
                    LLM responde con tu propio conocimiento
```

**Stack:** Node.js + LangChain + OpenAI Embeddings + Chroma (local)

**Valor inmediato:** Un chatbot que te explica TU estrategia cuando tienes dudas en vivo.

---

### Fase 2 – Scanner de Reglas (semana 2–3)
**Lo que construyes:**

Conectas a una API de datos (Alpaca, Polygon.io, Yahoo Finance) y corres filtros automáticos cada mañana a las 8am para generar tu watchlist.

```javascript
// Corre cada día a las 8:00am
const watchlist = await generarWatchlist({
  gapMin: 0.02,          // gap 2%+
  volPremarket: 100_000,
  volDiarioPromedio: 500_000,
  atrMin: 0.50,
  floatMax: 20_000_000
});

// Output:
// 1. NVDA - Gap +12%, Vol 8x, ATR $1.2, Float 15M → ⭐ ALTA PRIORIDAD
// 2. MSTR - Gap +6%, Vol 3x, ATR $2.1, Float 8M  → WATCHLIST
```

---

### Fase 3 – Agente de Estrategia en Vivo (semana 3–5)

El agente recibe datos del stock cada 1–5 minutos y genera alertas:

```
"09:42 – NVDA formando Bull Flag. Consolidación en 9 EMA. 
 Volumen bajando en velas rojas ✅. Espera candle verde > $18.55"

"09:46 – NVDA rompió $18.55 con volumen 3x ✅. 
 SEÑAL DE ENTRADA. Entry: $18.55 | Stop: $18.15 | Target: $18.75"

"09:52 – NVDA tocó $18.75 (Target 1). 
 VENDER MITAD. Mueve stop a $18.55 (break-even)"
```

---

### Fase 4 – Dashboard Visual (semana 5+)

Una interfaz simple (web o Telegram bot) que muestra:

```
┌─────────────────────────────────────┐
│  📊 WATCHLIST HOY – 09:30           │
├──────┬────────┬───────┬─────────────┤
│ NVDA │ +12%  │ 8x vol│ 🔴 ESPERAR  │
│ MSTR │ +8%   │ 5x vol│ 🟡 SETUP    │
│ SOFI │ +15%  │ 12x   │ 🟢 SEÑAL    │
└──────┴────────┴───────┴─────────────┘

🟢 SOFI – Bull Flag confirmado
   Entry: $8.45 | Stop: $8.15 | Target: $8.85
   RR: 1:2.7 | Size sugerido: 300 shares
   Hora: 09:41 | Sesión: THE OPEN ✅
```

---

## Por Qué NO Fine-tuning (todavía)

El fine-tuning tiene sentido cuando tienes:
- **Historial de trades reales**: "Este día, este setup, este resultado"
- **Miles de ejemplos** de decisiones correctas vs incorrectas

Con `knowledge.txt` solo, el fine-tuning sobreajustaría el texto teórico. 

**El orden correcto:**
1. RAG con tu knowledge → funciona hoy
2. Loguear todas las recomendaciones del agente + resultado real del trade
3. Con 6–12 meses de datos reales → fine-tuning sobre esos resultados

---

## Reglas Hardcodeadas Extraídas de tu Knowledge

Estas van directamente al código sin necesitar AI:

```javascript
const reglasParar = [
  "stop si 3 trades consecutivos perdedores",
  "stop si das back 50% del profit del día",
  "stop si llegas a max loss del día",
  "stop si sientes frustración o FOMO"
];

const reglasEntrada = {
  horaOptima: { desde: "09:30", hasta: "10:30" },    // The Open
  noEntrarDespuesDe: "14:00",                          // evitar Mid-day
  ratioMinimoRR: 2,                                    // 2:1 mínimo
  maxRiesgoPorTrade: 0.02,                             // 2% de cuenta
  maxRiesgoMensual: 0.06                               // 6% regla Elder
};

const positionSizing = (cuenta, stopCents) => {
  const maxRiesgo = cuenta * 0.01;                    // 1% por trade
  return Math.floor(maxRiesgo / (stopCents / 100));
};
```

---

## Stack Tecnológico Recomendado

```
Datos en tiempo real  →  Polygon.io / Alpaca API ($30/mes)
Vector DB             →  Chroma (gratis, local) o Pinecone
LLM                   →  OpenAI GPT-4o / Claude API
Framework             →  LangChain.js (ya usas Node.js)
Notificaciones        →  Telegram Bot (simple, ya en tu celular)
Base de datos trades  →  SQLite → migrar a Postgres cuando escales
```

---

## Lo Que el Agente NO Debe Hacer

- ❌ Ejecutar trades automáticamente (demasiado riesgo, empieza con alertas)
- ❌ Predecir precio futuro ("NVDA va a llegar a $20")
- ❌ Operar stocks que no cumplan los filtros del scanner
- ❌ Darte señales después de las 2pm (tu knowledge lo dice explícitamente)
- ❌ Sugerirte promediar pérdidas (averaging down)

---

## Próximos Pasos Concretos

1. **Hoy:** Instalar Chroma + LangChain, hacer embeddings de `knowledge.txt`, probar el RAG con preguntas de estrategia
2. **Esta semana:** Conectar Polygon.io y construir el scanner de filtros
3. **Próxima semana:** Agente que combina scanner + RAG y genera alertas por Telegram
4. **Mes 2:** Logear resultados reales de cada señal para futura mejora del modelo

---

> **Resumen:** Tu knowledge.txt es suficientemente rico y específico para alimentar un RAG útil hoy mismo. 
> Combinado con reglas deterministas para el scanner y un agente LLM que use ese conocimiento como 
> contexto, puedes tener un asistente que te diga exactamente **qué stock mirar, qué setup esperar, 
> a qué hora, con qué entry/stop/target y qué tamaño de posición** – basado 100% en tu propia metodología.
