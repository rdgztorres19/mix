#!/bin/bash

# 🐛 DEBUG ATPC - ANALIZAR DISCREPANCIAS ESPECIFICAS
echo "🔍 ANALIZANDO DISCREPANCIAS ATPC (WebSocket vs API Histórica)"
echo "==============================================================="

cd "/Users/rdgztorres19/Documents/Projects/node copy/stocks/trading-agent"

echo "📊 El script mostrará:"
echo "   🔴 Diferencias exactas en OHLCV"
echo "   📈 Análisis de cada campo (Open, High, Low, Close, Volume)"  
echo "   📋 Top mismatches con diferencias calculadas"
echo "   🕐 Timestamp 1773156480000 y similares casos"
echo ""

echo "🚀 LANZANDO DEBUG INSPECTOR..."
echo "👉 Ve a Chrome → chrome://inspect → 'Open dedicated DevTools for Node'"
echo ""

DEBUG=true node --inspect-brk ./scripts/fixed-sync-verification.js ATPC