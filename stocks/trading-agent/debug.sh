#!/bin/bash

# 🐛 DEBUG WRAPPER - LANZA DEBUGGING AUTOMATICAMENTE
echo "🚀 INICIANDO DEBUGGING AUTOMÁTICO..."
echo "==============================================="

# Verificar que estamos en el directorio correcto
if [ ! -f "./scripts/fixed-sync-verification.js" ]; then
    echo "❌ ERROR: No estás en el directorio trading-agent"
    echo "💡 Cambia a: cd '/Users/rdgztorres19/Documents/Projects/node copy/stocks/trading-agent'"
    exit 1
fi

echo "✅ Directorio correcto"
echo "📂 $(pwd)"
echo ""

# Usar símbolo del argumento o default
SYMBOL=${1:-CRCG}
echo "🎯 Debugging símbolo: $SYMBOL"
echo ""

echo "🔧 INSTRUCCIONES:"
echo "1. En 3 segundos se abrirá el debugger de Node.js"  
echo "2. Ve a Chrome/Chromium → chrome://inspect"
echo "3. Click 'Open dedicated DevTools for Node'"
echo "4. El script pausará INMEDIATAMENTE en el primer breakpoint"
echo "5. Usa F8 (Continue), F10 (Step Over), F11 (Step Into)"
echo ""

echo "⏳ Iniciando en 3 segundos..."
sleep 1 && echo "⏳ 2..."
sleep 1 && echo "⏳ 1..."
sleep 1

echo ""
echo "🚀 INICIANDO DEBUGGER..."
echo "📍 PAUSARÁ EN EL PRIMER BREAKPOINT"
echo ""

# Lanzar con inspector
DEBUG=true node --inspect-brk ./scripts/fixed-sync-verification.js "$SYMBOL"