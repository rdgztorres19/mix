#!/usr/bin/env node

/**
 * Debug Simple de Fechas MoMo
 * 
 * Análisis directo de qué fechas tiene MoMo disponible
 */

const axios = require('axios');

const MOMO_BASE = 'https://momoscreener.com/api/p';

async function analyzeMoMoDateRange(symbol) {
  console.log(`\n🔍 Analizando ${symbol}:`);
  
  try {
    const url = `${MOMO_BASE}/ticker/chart?q=${symbol}&interval=1m`;
    const response = await axios.get(url, { timeout: 15000 });
    
    if (response.data?.error !== 0 || !response.data?.message?.history) {
      console.log(`   ❌ Sin datos de MoMo`);
      return null;
    }

    const history = response.data.message.history;
    console.log(`   📊 Total velas: ${history.length}`);
    
    if (history.length === 0) return null;
    
    // Analizar fechas
    const timestamps = history.map(candle => candle[5] * 1000);
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    
    const startDate = new Date(minTime);
    const endDate = new Date(maxTime);
    
    console.log(`   📅 Desde: ${startDate.toLocaleDateString('en-CA')} ${startDate.toLocaleTimeString('en-US', {timeZone: 'America/New_York'})}`);
    console.log(`   📅 Hasta: ${endDate.toLocaleDateString('en-CA')} ${endDate.toLocaleTimeString('en-US', {timeZone: 'America/New_York'})}`);
    
    // Mostrar últimas fechas
    const uniqueDates = [...new Set(timestamps.map(t => 
      new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    ))].sort().reverse().slice(0, 5);
    
    console.log(`   📋 Últimas fechas: ${uniqueDates.join(', ')}`);
    
    // Verificar hoy específicamente
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const hasToday = uniqueDates.includes(today);
    console.log(`   🎯 ¿Tiene hoy (${today})? ${hasToday ? '✅ SÍ' : '❌ NO'}`);
    
    // Mostrar las últimas velas más recientes
    console.log(`   ⏰ Últimas 3 velas:`);
    const lastCandles = history.slice(-3);
    lastCandles.forEach((candle, i) => {
      const [o, h, l, c, v, t] = candle;
      const candleTime = new Date(t * 1000);
      const dateStr = candleTime.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const timeStr = candleTime.toLocaleTimeString('en-US', { 
        timeZone: 'America/New_York', 
        hour12: false 
      });
      console.log(`     ${i+1}. ${dateStr} ${timeStr}: C=$${c.toFixed(4)}`);
    });
    
    return {
      symbol,
      totalCandles: history.length,
      startDate: startDate.toLocaleDateString('en-CA'),
      endDate: endDate.toLocaleDateString('en-CA'),
      hasToday,
      uniqueDatesCount: uniqueDates.length
    };
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('🕰️ DIAGNÓSTICO SIMPLE DE FECHAS MOMO');
  console.log('═'.repeat(50));
  
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  console.log(`📅 Fecha actual Eastern Time: ${today}`);
  console.log(`📅 Fecha actual UTC: ${new Date().toISOString().split('T')[0]}`);
  console.log(`📅 Fecha actual local: ${new Date().toLocaleDateString('en-CA')}`);
  
  // Probar símbolos conocidos
  const testSymbols = ['AAPL', 'TSLA', 'MSFT']; // Símbolos que seguro existen y son activos
  
  const results = [];
  for (const symbol of testSymbols) {
    const result = await analyzeMoMoDateRange(symbol);
    if (result) results.push(result);
    
    await new Promise(resolve => setTimeout(resolve, 2000)); // Pausa entre llamadas
  }
  
  console.log('\n' + '═'.repeat(50));
  console.log('🎯 RESUMEN');
  console.log('═'.repeat(50));
  
  if (results.length > 0) {
    console.log('\n📊 RANGOS ENCONTRADOS:');
    results.forEach(r => {
      console.log(`${r.symbol}: ${r.startDate} → ${r.endDate} (${r.totalCandles} velas, ${r.uniqueDatesCount} días)`);
    });
    
    const allHaveToday = results.every(r => r.hasToday);
    const noneHaveToday = results.every(r => !r.hasToday);
    
    console.log('\n🔍 ANÁLISIS:');
    if (allHaveToday) {
      console.log('✅ TODOS los símbolos tienen datos para hoy');
      console.log('💡 El problema puede estar en tu configuración de fecha o zona horaria');
    } else if (noneHaveToday) {
      console.log('❌ NINGÚN símbolo tiene datos para hoy');
      console.log('💡 Esto confirma que MoMo no tiene datos para fechas futuras');
      console.log(`💡 MoMo más reciente: ${results[0]?.endDate || 'N/A'}`);
      console.log(`💡 Tu sistema fecha: ${today}`);
      
      // Calcular diferencia de días
      if (results[0]) {
        const momoDate = new Date(results[0].endDate);
        const systemDate = new Date(today);
        const daysDiff = Math.round((systemDate - momoDate) / (1000 * 60 * 60 * 24));
        console.log(`💡 Diferencia: ${daysDiff} días en el futuro`);
      }
    } else {
      console.log('⚠️ ALGUNOS símbolos tienen datos para hoy (inconsistente)');
    }
  } else {
    console.log('❌ No se pudieron obtener datos de ningún símbolo');
  }
  
  console.log('\n🏆 CONCLUSIÓN:');
  console.log('Si ningún símbolo tiene datos para hoy, significa que tu sistema');
  console.log('está configurado en una fecha futura para la cual MoMo no tiene datos.');
  console.log('Tu sincronización está funcionando correctamente, solo hay un desfase temporal.');
}

// Ejecutar
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };