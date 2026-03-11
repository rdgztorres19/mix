#!/usr/bin/env node

/**
 * Historical Data Sync Test
 * 
 * Compara datos de MySQL con MoMo usando fechas históricas reales
 */

const axios = require('axios');
const mysql = require('mysql2/promise');

// Configuración
const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || 'sbrQp10',
  database: process.env.MYSQL_DATABASE_TRAINING || 'stock_training',
};

const MOMO_BASE = 'https://momoscreener.com/api/p';

async function getAvailableDates() {
  console.log('📅 Obteniendo fechas disponibles en MySQL...');
  try {
    const pool = mysql.createPool(MYSQL_CONFIG);
    const [rows] = await pool.query(
      'SELECT DISTINCT date FROM training_1m ORDER BY date DESC LIMIT 10'
    );
    const dates = rows.map(r => r.date);
    console.log(`✅ Fechas disponibles: ${dates.join(', ')}`);
    await pool.end();
    return dates;
  } catch (error) {
    console.error('❌ Error obteniendo fechas:', error.message);
    return [];
  }
}

async function getSymbolsForDate(date) {
  console.log(`📋 Obteniendo símbolos para ${date}...`);
  try {
    const pool = mysql.createPool(MYSQL_CONFIG);
    const [rows] = await pool.query(
      'SELECT DISTINCT symbol FROM training_1m WHERE date = ? ORDER BY symbol LIMIT 5',
      [date]
    );
    const symbols = rows.map(r => r.symbol);
    console.log(`✅ Símbolos encontrados: ${symbols.join(', ')}`);
    await pool.end();
    return symbols;
  } catch (error) {
    console.error('❌ Error obteniendo símbolos:', error.message);
    return [];
  }
}

async function compareSymbolForDate(symbol, date, limit = 5) {
  console.log(`\n🔍 Comparando ${symbol} para ${date}:`);
  
  try {
    // MySQL data (últimas N velas del día)
    const pool = mysql.createPool(MYSQL_CONFIG);
    const [mysqlRows] = await pool.query(
      `SELECT candle_time_et, open, high, low, close, volume 
       FROM training_1m 
       WHERE symbol = ? AND date = ? 
       ORDER BY candle_time_et DESC 
       LIMIT ?`,
      [symbol, date, limit]
    );
    
    console.log(`   📊 MySQL: ${mysqlRows.length} velas encontradas`);
    
    if (mysqlRows.length > 0) {
      mysqlRows.forEach((row, i) => {
        console.log(`     ${i+1}. ${row.candle_time_et}: O=${row.open} H=${row.high} L=${row.low} C=${row.close} V=${row.volume}`);
      });
    }
    
    await pool.end();
    
    // MoMo data
    const url = `${MOMO_BASE}/ticker/chart?q=${symbol}&interval=1m`;
    const response = await axios.get(url, { timeout: 10000 });
    
    if (response.data?.error === 0 && response.data?.message?.history) {
      const allCandles = response.data.message.history;
      
      // Buscar velas para la fecha específica
      const targetCandles = allCandles.filter(([o, h, l, c, v, t]) => {
        const candleDate = new Date(t * 1000).toLocaleDateString('en-CA', { 
          timeZone: 'America/New_York' 
        });
        return candleDate === date;
      });
      
      console.log(`   🌐 MoMo: ${targetCandles.length} velas para ${date}`);
      
      if (targetCandles.length > 0) {
        // Mostrar últimas N velas
        const lastCandles = targetCandles.slice(-limit).reverse();
        lastCandles.forEach((candle, i) => {
          const [o, h, l, c, v, t] = candle;
          const time = new Date(t * 1000).toLocaleTimeString('en-US', {
            timeZone: 'America/New_York',
            hour12: false,
            hour: '2-digit',
            minute: '2-digit'
          });
          console.log(`     ${i+1}. ${time}: O=${o} H=${h} L=${l} C=${c} V=${v}`);
        });
        
        // Comparar última vela si ambas fuentes tienen datos
        if (mysqlRows.length > 0 && targetCandles.length > 0) {
          const mysqlLast = mysqlRows[0]; // Ya ordenado DESC
          const momoLast = targetCandles[targetCandles.length - 1];
          
          console.log(`\n   🔄 Comparando última vela:`);
          console.log(`     MySQL: ${mysqlLast.candle_time_et} - Close: ${mysqlLast.close}`);
          console.log(`     MoMo:  ${new Date(momoLast[5] * 1000).toLocaleTimeString('en-US', {
            timeZone: 'America/New_York',
            hour12: false,
            hour: '2-digit',
            minute: '2-digit'
          })} - Close: ${momoLast[3]}`);
          
          const priceDiff = Math.abs(parseFloat(mysqlLast.close) - momoLast[3]);
          const match = priceDiff < 0.01; // Tolerance de 1 centavo
          console.log(`     Status: ${match ? '✅ MATCH' : `⚠️ DIFF (${priceDiff.toFixed(4)})`}`);
          
          return { mysql: mysqlRows.length, momo: targetCandles.length, match };
        }
      } else {
        console.log(`   ⚠️ MoMo no tiene datos para ${date}`);
      }
      
      return { mysql: mysqlRows.length, momo: targetCandles.length, match: false };
      
    } else {
      console.log('   ❌ MoMo API error o sin datos');
      return { mysql: mysqlRows.length, momo: 0, match: false };
    }
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return { mysql: 0, momo: 0, match: false };
  }
}

async function main() {
  console.log('📈 HISTORICAL DATA SYNC VERIFICATION');
  console.log('='.repeat(60));
  
  // Obtener fechas disponibles
  const dates = await getAvailableDates();
  
  if (dates.length === 0) {
    console.log('❌ No hay fechas disponibles en MySQL');
    return;
  }
  
  // Usar la fecha más reciente
  const testDate = dates[0];
  console.log(`\n🎯 Testing with most recent date: ${testDate}`);
  
  // Obtener símbolos para esa fecha
  const symbols = await getSymbolsForDate(testDate);
  
  if (symbols.length === 0) {
    console.log(`❌ No hay símbolos para ${testDate}`);
    return;
  }
  
  // Comparar datos para cada símbolo
  const results = [];
  for (const symbol of symbols) {
    const result = await compareSymbolForDate(symbol, testDate);
    results.push({ symbol, testDate, ...result });
    
    // Pausa para no sobrecargar APIs
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  
  // Resumen
  console.log('\n' + '='.repeat(60));
  console.log('🎯 FINAL SUMMARY');
  console.log('='.repeat(60));
  
  results.forEach(r => {
    const status = r.match ? '✅ MATCH' : 
                  r.mysql > 0 && r.momo > 0 ? '⚠️ DIFF' : '❌ MISSING';
    console.log(`${r.symbol} (${r.testDate}): MySQL=${r.mysql}, MoMo=${r.momo} ${status}`);
  });
  
  const matches = results.filter(r => r.match).length;
  const withData = results.filter(r => r.mysql > 0 && r.momo > 0).length;
  
  console.log(`\n🏆 Results: ${matches}/${results.length} perfect matches, ${withData}/${results.length} have data in both sources`);
  
  if (matches === results.length) {
    console.log('🎉 ¡Todos los datos están perfectamente sincronizados!');
  } else if (withData === 0) {
    console.log('🤔 Ningún símbolo tiene datos en ambas fuentes - verifica conectividad');
  } else {
    console.log('⚠️ Hay discrepancias entre fuentes de datos');
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };