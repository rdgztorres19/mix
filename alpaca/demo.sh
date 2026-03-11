#!/bin/bash

# 🚀 DEMO ALPACA ACXP - Demonstración completa
echo "🚀 DEMO COMPLETO - Alpaca ACXP Data Integration"
echo "=============================================="
echo ""

cd "/Users/rdgztorres19/Documents/Projects/node copy/alpaca"

echo "📋 Archivos creados:"
echo "  ✅ websocket-acxp.js    - WebSocket tiempo real"
echo "  ✅ historical-acxp.js   - Datos históricos"
echo "  ✅ test-connection.js   - Test de conexión"
echo "  ✅ package.json         - Dependencias"
echo "  ✅ README.md           - Documentación"
echo ""

echo "🧪 PASO 1: Test de conexión..."
echo "==============================="
node test-connection.js
echo ""

echo "📊 PASO 2: Datos históricos (ejecutando por 10 segundos)..."
echo "==========================================================="
node historical-acxp.js
echo ""

echo "🎯 PASO 3: Instrucciones para WebSocket..."
echo "=========================================="
echo "💡 Para iniciar WebSocket en tiempo real:"
echo "   cd alpaca"
echo "   npm run websocket"
echo ""

echo "🚨 NOTA: El WebSocket se ejecuta indefinidamente mostrando:"
echo "   🔥 Trades en tiempo real"
echo "   📈 Quotes (bid/ask) actualizados"
echo "   📊 Candles de 1 minuto completados"
echo ""

echo "✅ DEMO COMPLETADO"
echo "=================="
echo "📂 Ubicación: /Users/rdgztorres19/Documents/Projects/node copy/alpaca"
echo "📖 Lee README.md para más detalles"