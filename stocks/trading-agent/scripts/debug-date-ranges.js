#!/usr/bin/env node

/**
 * Debug del Rango de Fechas de MoMo
 * 
 * Analiza qué fechas tiene disponibles MoMo vs MySQL
 */

const axios = require('axios');
const mysql = require('mysql2/promise');

const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || 'sbrQp10',
  database: process.env.MYSQL_DATABASE_TRAINING || 'stock_training',
};

const MOMO_BASE = 'https://momoscreener.com/api/p';

async function analyzeDateRange(symbol) {
  console.log(`\n🔍 Analizando rango de fechas para ${symbol}:`);
  
  try {
    // Obtener datos de MoMo
    const url = `${MOMO_BASE}/ticker/chart?q=${symbol}&interval=1m`;
    const response = await axios.get(url, { timeout: 15000 });
    
    if (response.data?.error !== 0 || !response.data?.message?.history) {
      console.log(`   ❌ Sin datos de MoMo`);
      return null;
    }

    const history = response.data.message.history;
    console.log(`   📊 MoMo: ${history.length} velas históricas`);
    
    if (history.length === 0) return null;
    
    // Analizar rango de fechas
    const timestamps = history.map(candle => candle[5] * 1000); // Convert to milliseconds
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    
    const startDate = new Date(minTime).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const endDate = new Date(maxTime).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    
    console.log(`   📅 Rango MoMo: ${startDate} a ${endDate}`);
    
    // Mostrar las últimas 5 fechas para ver el patrón
    const uniqueDates = [...new Set(timestamps.map(t => 
      new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    ))].sort();
    
    const recentDates = uniqueDates.slice(-5);
    console.log(`   📋 Últimas 5 fechas: ${recentDates.join(', ')}`);
    
    // Verificar si tiene hoy
    const targetDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const hasToday = uniqueDates.includes(targetDate);
    console.log(`   🎯 ¿Tiene datos para hoy (${targetDate})? ${hasToday ? '✅ SÍ' : '❌ NO'}`);
    
    // Contar velas por fecha (las más recientes)
    const dateCount = {};
    timestamps.forEach(t => {
      const date = new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      dateCount[date] = (dateCount[date] || 0) + 1;
    });
    
    const recentCounts = Object.entries(dateCount)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 3);
    
    console.log(`   📈 Velas por fecha reciente:`);
    recentCounts.forEach(([date, count]) => {
      console.log(`     ${date}: ${count} velas`);
    });
    
    return {
      symbol,
      totalCandles: history.length,
      startDate,
      endDate,
      uniqueDates: uniqueDates.length,
      hasToday,
      recentDates,
      recentCounts
    };
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return null;
  }
}

async function getMySQLDateRange() {
  console.log('📊 Analizando fechas en MySQL...');
  try {
    const pool = mysql.createPool(MYSQL_CONFIG);
    const [rows] = await pool.query(
      `SELECT date, COUNT(*) as candle_count 
       FROM training_1m 
       GROUP BY date
       ORDER BY date DESC 
       LIMIT 10`
    );
    
    console.log('✅ Fechas en MySQL:');
    rows.forEach(row => {
      console.log(`   ${row.date}: ${row.candle_count} velas`);
    });
    
    await pool.end();
    return rows;
  } catch (error) {
    console.error('❌ Error MySQL:', error.message);
    return [];
  }
}

async function main() {
  console.log('🕰️ DIAGNÓSTICO DE FECHAS: MySQL vs MoMo');
  console.log('═'.repeat(60));
  
  // Analizar MySQL primero
  const mysqlDates = await getMySQLDateRange();
  
  if (mysqlDates.length === 0) {
    console.log('❌ No hay datos en MySQL');
    return;
  }
  
  console.log('\n' + '─'.repeat(40));
  
  // Tomar símbolos comunes para analizar
  const testSymbols = ['AAPL', 'TSLA', 'NIO']; // Símbolos que seguro existen
  
  const results = [];
  for (const symbol of testSymbols) {
    const result = await analyzeDateRange(symbol);
    if (result) results.push(result);
    
    await new Promise(resolve => setTimeout(resolve, 1500)); // Pausa
  }
  
  console.log('\n' + '═'.repeat(60));
  console.log('🔍 ANÁLISIS FINAL');
  console.log('═'.repeat(60));
  
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  
  console.log(`📅 Fecha actual: ${today}`);
  console.log(`📊 MySQL tiene datos para: ${mysqlDates[0]?.date || 'N/A'}`);
  
  if (results.length > 0) {
    console.log('\n📈 RANGO MOMO:');
    results.forEach(r => {
      console.log(`  ${r.symbol}: ${r.startDate} → ${r.endDate} (${r.uniqueDates} días, ${r.totalCandles} velas)`);
      console.log(`    Últimas fechas: ${r.recentDates.slice(-3).join(', ')}`);
      console.log(`    ¿Tiene hoy? ${r.hasToday ? '✅' : '❌'}`);
    });
    
    const allHaveToday = results.every(r => r.hasToday);
    const noneHaveToday = results.every(r => !r.hasToday);
    
    console.log('\n🎯 CONCLUSIÓN:');
    if (allHaveToday) {
      console.log('✅ MoMo SÍ tiene datos para hoy - puede haber otro problema');
    } else if (noneHaveToday) {
      console.log('❌ MoMo NO tiene datos para hoy - explica las discrepancias');
      console.log('💡 Recomendación: Verificar si el sistema está usando la fecha correcta');
    } else {
      console.log('⚠️ MoMo tiene datos parciales para hoy');
    }
    
    // Mostrar la brecha de fechas
    const latestMomoDate = Math.max(...results.map(r => new Date(r.endDate).getTime()));
    const latestMomoDateStr = new Date(latestMomoDate).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const mysqlDateStr = mysqlDates[0]?.date;
    
    console.log(`\n📊 BRECHA DE DATOS:`);
    console.log(`   MoMo más reciente: ${latestMomoDateStr}`);
    console.log(`   MySQL más reciente: ${mysqlDateStr}`);
    
    if (mysqlDateStr && latestMomoDateStr !== mysqlDateStr) {
      const daysDiff = (new Date(mysqlDateStr) - new Date(latestMomoDateStr)) / (1000 * 60 * 60 * 24);
      console.log(`   Diferencia: ${daysDiff.toFixed(0)} días`);
      
      if (daysDiff > 0) {
        console.log('⚠️ MySQL tiene datos más nuevos que MoMo');
      } else {
        console.log('⚠️ MoMo tiene datos más nuevos que MySQL');
      }
    }
  }
}

// Ejecutar
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };