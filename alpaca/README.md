# 🚀 Alpaca ACXP Data Integration

Integración con la API de Alpaca para obtener datos del stock **ACXP** tanto en tiempo real (WebSocket) como históricos (REST API).

## 📂 Archivos

- **`websocket-acxp.js`** - WebSocket para datos en tiempo real de ACXP
- **`historical-acxp.js`** - API REST para datos históricos de ACXP
- **`package.json`** - Dependencias del proyecto

## ⚙️ Configuración

Los archivos usan las credenciales de Alpaca configuradas:
```javascript
ALPACA_KEY_ID = 'PKBLVB6V5QWCSU2TLPHJ'
ALPACA_SECRET_KEY = 'Vhuk22MepdEauPUtAmxGjfLRoARzwLBiiNvgjpbG'
```

## 🚀 Instalación y Uso

### 1. Instalar dependencias
```bash
cd alpaca
npm install
```

### 2. Datos en Tiempo Real (WebSocket)
```bash
# Opción 1: Comando directo
node websocket-acxp.js

# Opción 2: Script npm
npm run websocket
```

**Datos que recibes:**
- 🔥 **Trades**: Precio, volumen, exchange en tiempo real
- 📈 **Quotes**: Bid/Ask prices y sizes actualizados
- 📊 **Bars**: Candles de 1 minuto completados

### 3. Datos Históricos
```bash
# Opción 1: Comando directo  
node historical-acxp.js

# Opción 2: Script npm
npm run historical
```

**Datos que obtienes:**
- 📊 Barras de 1 minuto (últimos 7 días)
- 💰 Cotización más reciente (Bid/Ask)
- 🔥 Último trade ejecutado
- 📈 Estadísticas del período (min/max/volumen)

## 📊 Salida de Ejemplo

### WebSocket (Tiempo Real):
```
🔥 TRADE ACXP:
   ⏰ Time: 10:45:23
   💰 Price: $3.97
   📊 Size: 100 shares
   🏢 Exchange: IEX

📊 1-MINUTE BAR ACXP:
   ⏰ Time: 10:45:00
   🟢 Open: $3.995
   🔴 High: $4.00
   🟡 Low: $3.96
   ⚫ Close: $3.97
   📈 Volume: 1250 shares
   📉 Change: -0.63%
```

### Histórico:
```
📊 RESUMEN DE BARRAS (500 candles):
================================================

🔝 Primeras 5 barras:
1. 3/10/2026, 9:30:00 AM
   O: $3.95 | H: $4.01 | L: $3.94 | C: $3.98
   Volume: 2,340 | 📈 0.76%

📈 ESTADÍSTICAS:
   🔹 Precio mínimo: $3.85
   🔸 Precio máximo: $4.12
   📊 Volumen promedio: 1,847
   📈 Volumen total: 923,500
```

## 🔧 Características

### WebSocket (`websocket-acxp.js`)
- ✅ Autenticación automática
- ✅ Reconexión automática en caso de desconexión
- ✅ Manejo de múltiples tipos de mensaje (trades, quotes, bars)
- ✅ Formateo claro de datos en tiempo real
- ✅ Cálculo automático de spreads y cambios porcentuales

### Histórico (`historical-acxp.js`)
- ✅ Obtiene datos de los últimos 7 días
- ✅ Muestra primeras y últimas 5 barras
- ✅ Estadísticas automáticas (min/max/promedio)
- ✅ Cotización y último trade actuales  
- ✅ Manejo de errores robusto

## 🛑 Control

- **WebSocket**: Presiona `Ctrl+C` para detener
- **Histórico**: Se ejecuta una vez y termina automáticamente

## 📊 Datos Usados

- **Feed**: IEX (gratis con cuenta Alpaca)
- **Timeframe**: 1 minuto
- **Símbolo**: ACXP (fijo en ambos archivos)
- **API**: Alpaca Markets Data API v2

## 🔍 Debugging

Si hay errores, los archivos muestran:
- ❌ Errores de conexión
- 📄 Respuestas completas de la API
- 📊 Status codes HTTP
- 🔐 Estado de autenticación

## 📝 Notas

- Los datos son de **IEX** (15 minutos de delay en cuenta gratuita)
- **Una sola conexión WebSocket** permitida por API key (free tier)
- Los archivos **solo se ejecutan cuando los corres manualmente**
- Las credenciales están hardcodeadas para simplicidad