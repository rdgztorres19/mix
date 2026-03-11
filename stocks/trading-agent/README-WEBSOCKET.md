# 🚀 Alpaca WebSocket Integration

Integración de WebSocket premium SIP de Alpaca para datos en tiempo real con fallback automático.

## 📊 Características

- **Premium SIP Feed**: `wss://stream.data.alpaca.markets/v2/sip`  
- **Reconexión Automática**: Reconecta cada 5 segundos si se pierde conexión
- **Fallback Cron**: Verifica cada 61 segundos si el WebSocket recibió datos, sino usa REST API
- **Cache & Retry**: Integración con `AlpacaDataSource` existente
- **Multi-Simbolos**: Configurable vía `ALPACA_WEBSOCKET_SYMBOLS`
- **Abstracción**: Integrado con NestJS usando `IWebSocketDataSource`

## 🔧 Configuración

Agregar al `.env`:

```bash
# WebSocket Configuration
ALPACA_WEBSOCKET_ENABLED=true
ALPACA_WEBSOCKET_SYMBOLS=ACXP,AAPL,TSLA
ALPACA_RECONNECT_INTERVAL_MS=5000
WEBSOCKET_FALLBACK_ENABLED=true

# Alpaca Credentials (ya configuradas)
ALPACA_KEY_ID=PKBLVB6V5QWCSU2TLPHJ
ALPACA_SECRET_KEY=Vhuk22MepdEauPUtAmxGjfLRoARzwLBiiNvgjpbG
```

## 🚀 Uso

### Start Trading Agent (WebSocket auto-inicia)
```bash
npm run start:dev
```

### Probar WebSocket standalone
```bash
npm run test-websocket
npm run test-websocket ACXP AAPL TSLA
```

### Logs esperados
```
🚀 Alpaca WebSocket initialized - Symbols: [ACXP]
📡 Connecting to Alpaca Premium SIP WebSocket...
✅ WebSocket connected - authenticating...
🎉 Authentication successful
📊 Subscribing to bars: [ACXP]
📋 Subscription confirmed: {...}

📊 1-MIN BAR ACXP
⏰ 4:48:37 PM
🟢 Open: $3.99 | 🔴 High: $4.01 | 🟡 Low: $3.97 | ⚫ Close: $3.98
📦 Volume: 1250 📈 -0.25%
```

## 🛡️ Fallback System

**Cron Job** ejecuta cada **61 segundos** (1 segundo después de cada minuto):

1. ✅ **WebSocket OK**: Verifica que se recibieron datos del último minuto  
2. ⚠️ **Datos faltantes**: Detecta si no llegó bar del minuto anterior
3. 🔄 **Fallback API**: Llama `/v2/stocks/{symbol}/bars?feed=sip&start=...&end=...`
4. 📦 **Procesamiento**: Procesa datos faltantes igual que datos WebSocket

### Ejemplo API Fallback:
```
⚠️ Missing WebSocket data for ACXP at 2026-03-10T16:48:00.000Z
🔄 Fetching fallback data for ACXP: 2026-03-10T16:48:00Z
✅ Fallback data retrieved for ACXP: $3.98 (Vol: 1250)
```

## 🏗️ Arquitectura

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   WebSocket     │    │  Fallback Cron   │    │  AlpacaDataSource│
│   (Real-time)   │    │  (Every 61s)     │    │   (REST API)    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         └─── IWebSocketDataSource Interface ────────────┘
                                │
                   ┌────────────────────────┐
                   │   Trading Agent App    │
                   │  - Scanner Module      │
                   │  - Real-time Alerts    │  
                   │  - Data Processing     │
                   └────────────────────────┘
```

## 📁 Archivos Creados

- `src/websocket/websocket.interface.ts` - Interfaces TypeScript
- `src/websocket/alpaca-websocket.service.ts` - Servicio WebSocket principal  
- `src/websocket/websocket-fallback.cron.ts` - Cron fallback cada 61s
- `src/websocket/websocket-init.service.ts` - Auto-start en module init
- `src/websocket/websocket.module.ts` - Módulo NestJS
- `scripts/test-websocket.js` - Script de prueba standalone
- `.env.websocket.example` - Configuración ejemplo

## 🔄 Flujo de Datos

1. **App Start**: `WebSocketInitService` conecta automáticamente
2. **Authentication**: Usa `ALPACA_KEY_ID` y `ALPACA_SECRET_KEY`  
3. **Subscription**: Subscribe a símbolos en `ALPACA_WEBSOCKET_SYMBOLS`
4. **Real-time Bars**: Recibe bars 1-min vía WebSocket SIP premium
5. **Processing**: Callbacks procesan cada bar (logs, DB, cache, etc.)
6. **Health Check**: Cron verifica cada 61s si recibió datos esperados
7. **Fallback**: Si faltan datos, llama REST API con mismo endpoint premium
8. **Resilience**: Reconexión automática si WebSocket falla

## ✅ Integración Completa

- ✅ **AlpacaDataSource**: Premium SIP REST API con cache/retry/fallback  
- ✅ **AlpacaWebSocket**: Premium SIP WebSocket con reconexión automática
- ✅ **Fallback Cron**: Monitoreo de salud y recuperación automática
- ✅ **TypeScript**: Tipado completo con interfaces
- ✅ **NestJS**: Integración modular con inyección de dependencias
- ✅ **Configuration**: Variables de entorno flexibles
- ✅ **Testing**: Scripts de prueba standalone

**🎯 Resultado**: Trading Agent ahora recibe datos premium en tiempo real con máxima confiabilidad.