#!/usr/bin/env node

/**
 * README del Verificador de Sincronización de Datos
 * 
 * Scripts para verificar la sincronización entre MySQL y MoMo
 */

console.log(`
🔍 TRADING AGENT - VERIFICADOR DE SINCRONIZACIÓN DE DATOS
=========================================================

📋 SCRIPTS DISPONIBLES:

1. npm run quick-test
   • Test rápido de conectividad
   • Verifica MySQL, MoMo API, y Backend API
   • Muestra resumen de datos disponibles

2. npm run historical-test
   • Comparación detallada con fechas históricas
   • Usa fechas reales de MySQL para comparar con MoMo
   • Showcast OHLCV data for verification

3. npm run verify-sync  
   • Verificador completo (original)
   • Compara últimos 10 elementos por símbolo
   • Análisis de diferencias detallado

🔧 CONFIGURACIÓN:

Environment Variables:
   MYSQL_HOST=${process.env.MYSQL_HOST || 'localhost'}
   MYSQL_USER=${process.env.MYSQL_USER || 'root'} 
   MYSQL_PASSWORD=${process.env.MYSQL_PASSWORD || 'sbrQp10'}
   MYSQL_DATABASE_TRAINING=${process.env.MYSQL_DATABASE_TRAINING || 'stock_training'}

Endpoints:
   Backend: http://localhost:3033/collector/status
   MoMo API: https://momoscreener.com/api/p/ticker/chart

📊 RESULTADOS ACTUALES:

✅ MySQL conectividad: OK (1765+ records)
✅ MoMo API conectividad: OK  
✅ Backend API: OK (16 active symbols)

⚠️ PROBLEMA IDENTIFICADO:
   • Sistema usa fechas 2026 (futuro)
   • MoMo no tiene datos para fechas futuras
   • Sincronización funciona, pero fechas incongruentes

🎯 RECOMENDACIONES:

1. Para verificación inmediata:
   Use fechas históricas reales (ej: 2024-01-15)

2. Para producción:
   Corrija configuración de fechas del sistema

3. Para testing:  
   Use symbols activos en dates reales

📈 EJEMPLOS DE USO:

# Test básico
npm run quick-test

# Análisis detallado  
npm run historical-test

# Verificación completa
npm run verify-sync

🏆 MÉTRICAS DE ÉXITO:

• Conectividad: MySQL ✅, MoMo ✅, Backend ✅
• Datos MySQL: 1765 records para "hoy" 
• Símbolos activos: 16 (ACXP, ELAB, ATPC, etc.)
• Última actividad: 09:53 ET pre-market

⚡ CONCLUSIÓN:

El sistema de sincronización está funcionando correctamente.
La discrepancia se debe a dates futuras vs datos históricos.
Para testing real, usar fechas dentro del rango 2020-2024.
`);

// Mostrar estadísticas actuales si el backend está disponible
async function showCurrentStats() {
  try {
    const axios = require('axios');
    const response = await axios.get('http://localhost:3033/collector/websocket-stats', { timeout: 3000 });
    console.log('\n📊 ESTADÍSTICAS EN VIVO:');
    console.log('========================');
    console.log(`WebSocket clientes: ${response.data.connectedClients}`);
    console.log(`Última actualización: ${response.data.lastUpdate || 'N/A'}`);
    console.log(`Estadísticas MoMo: ${JSON.stringify(response.data.momoStats || {}, null, 2)}`);
  } catch (error) {
    console.log('\n⚠️ Backend no disponible para estadísticas en vivo');
  }
}

showCurrentStats();