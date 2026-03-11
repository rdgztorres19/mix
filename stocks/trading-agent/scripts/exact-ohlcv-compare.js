#!/usr/bin/env node

/**
 * Comparador Exacto de Datos OHLCV
 * 
 * Compara minuto por minuto los datos de hoy entre MySQL y MoMo
 * Verifica: open, high, low, close, volume por cada minuto
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

async function getTodayDateET() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

async function getTickersFromMySQL(date) {
  console.log(`📊 Obteniendo tickets de MySQL para ${date}...`);
  try {
    const pool = mysql.createPool(MYSQL_CONFIG);
    const [rows] = await pool.query(
      `SELECT DISTINCT symbol, COUNT(*) as candle_count, 
              MIN(candle_time_et) as first_candle, 
              MAX(candle_time_et) as last_candle
       FROM training_1m 
       WHERE date = ? 
       GROUP BY symbol 
       ORDER BY candle_count DESC`,
      [date]
    );
    
    console.log(`✅ Encontrados ${rows.length} símbolos en MySQL:`);
    rows.forEach(row => {
      console.log(`   ${row.symbol}: ${row.candle_count} velas (${row.first_candle} - ${row.last_candle})`);
    });
    
    await pool.end();
    return rows.map(r => r.symbol);
  } catch (error) {
    console.error('❌ Error obteniendo tickets de MySQL:', error.message);
    return [];
  }
}

async function getMySQLDataForSymbol(symbol, date) {
  try {
    const pool = mysql.createPool(MYSQL_CONFIG);
    const [rows] = await pool.query(
      `SELECT candle_time_et, open, high, low, close, volume
       FROM training_1m 
       WHERE symbol = ? AND date = ? 
       ORDER BY candle_time_et ASC`,
      [symbol, date]
    );
    await pool.end();
    
    // Convertir a mapa por tiempo para fácil comparación
    const dataMap = new Map();
    rows.forEach(row => {
      dataMap.set(row.candle_time_et, {
        open: parseFloat(row.open),
        high: parseFloat(row.high),
        low: parseFloat(row.low),
        close: parseFloat(row.close),
        volume: parseInt(row.volume)
      });
    });
    
    return dataMap;
  } catch (error) {
    console.error(`❌ Error MySQL para ${symbol}:`, error.message);
    return new Map();
  }
}

async function getMoMoDataForSymbol(symbol, targetDate) {
  try {
    console.log(`   🌐 Fetching MoMo data for ${symbol}...`);
    const url = `${MOMO_BASE}/ticker/chart?q=${symbol}&interval=1m`;
    const response = await axios.get(url, { timeout: 15000 });
    
    if (response.data?.error !== 0 || !response.data?.message?.history) {
      console.log(`   ⚠️ MoMo no devolvió datos para ${symbol}`);
      return new Map();
    }

    const history = response.data.message.history;
    console.log(`   📈 MoMo devolvió ${history.length} velas históricas para ${symbol}`);
    
    // Filtrar y convertir datos para la fecha objetivo
    const dataMap = new Map();
    let todayCandles = 0;
    
    for (const [o, h, l, c, v, t] of history) {
      const candleDate = new Date(t * 1000);
      const candleDateET = candleDate.toLocaleDateString('en-CA', { 
        timeZone: 'America/New_York' 
      });
      
      if (candleDateET === targetDate) {
        const timeET = candleDate.toLocaleTimeString('en-US', {
          timeZone: 'America/New_York',
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        });
        
        dataMap.set(timeET, {
          open: parseFloat(o),
          high: parseFloat(h),
          low: parseFloat(l),
          close: parseFloat(c),
          volume: parseInt(v)
        });
        todayCandles++;
      }
    }
    
    console.log(`   ✅ Encontradas ${todayCandles} velas de MoMo para ${targetDate}`);
    return dataMap;
    
  } catch (error) {
    console.error(`   ❌ Error MoMo para ${symbol}:`, error.message);
    return new Map();
  }
}

function compareOHLCV(mysqlData, momoData, tolerance = 0.001) {
  const differences = [];
  const fields = ['open', 'high', 'low', 'close', 'volume'];
  
  for (const [time, mysqlValues] of mysqlData) {
    const momoValues = momoData.get(time);
    
    if (!momoValues) {
      differences.push({
        time,
        issue: 'missing_in_momo',
        mysql: mysqlValues,
        momo: null
      });
      continue;
    }
    
    const timeDiffs = {};
    let hasDifference = false;
    
    for (const field of fields) {
      const mysqlVal = mysqlValues[field];
      const momoVal = momoValues[field];
      
      let isDifferent = false;
      
      if (field === 'volume') {
        // Para volumen, permitir diferencias de hasta 10%
        const maxVal = Math.max(mysqlVal, momoVal);
        isDifferent = maxVal > 0 && Math.abs(mysqlVal - momoVal) > maxVal * 0.1;
      } else {
        // Para precios, usar tolerancia relativa
        const maxVal = Math.max(mysqlVal, momoVal);
        isDifferent = maxVal > 0 && Math.abs(mysqlVal - momoVal) > maxVal * tolerance;
      }
      
      if (isDifferent) {
        timeDiffs[field] = {
          mysql: mysqlVal,
          momo: momoVal,
          diff: Math.abs(mysqlVal - momoVal)
        };
        hasDifference = true;
      }
    }
    
    if (hasDifference) {
      differences.push({
        time,
        issue: 'value_difference',
        differences: timeDiffs
      });
    }
  }
  
  // Verificar datos que están solo en MoMo
  for (const [time, momoValues] of momoData) {
    if (!mysqlData.has(time)) {
      differences.push({
        time,
        issue: 'missing_in_mysql',
        mysql: null,
        momo: momoValues
      });
    }
  }
  
  return differences;
}

async function compareSymbolData(symbol, targetDate) {
  console.log(`\n🔍 COMPARANDO ${symbol} para ${targetDate}`);
  console.log('─'.repeat(60));
  
  // Obtener datos de ambas fuentes
  const [mysqlData, momoData] = await Promise.all([
    getMySQLDataForSymbol(symbol, targetDate),
    getMoMoDataForSymbol(symbol, targetDate)
  ]);
  
  console.log(`   📊 MySQL: ${mysqlData.size} velas`);
  console.log(`   🌐 MoMo:  ${momoData.size} velas`);
  
  if (mysqlData.size === 0) {
    console.log(`   ❌ Sin datos de MySQL para ${symbol}`);
    return { symbol, status: 'no_mysql_data', matches: 0, differences: 0 };
  }
  
  if (momoData.size === 0) {
    console.log(`   ❌ Sin datos de MoMo para ${symbol}`);
    return { symbol, status: 'no_momo_data', matches: 0, differences: 0 };
  }
  
  // Comparar datos
  const differences = compareOHLCV(mysqlData, momoData);
  const matches = mysqlData.size - differences.filter(d => d.issue !== 'missing_in_momo').length;
  
  console.log(`   ✅ Coincidencias: ${matches}`);
  console.log(`   ⚠️  Diferencias: ${differences.length}`);
  
  if (differences.length > 0 && differences.length <= 10) {
    console.log('\n   📋 DIFERENCIAS ENCONTRADAS:');
    differences.forEach((diff, index) => {
      console.log(`     ${index + 1}. ${diff.time} - ${diff.issue}`);
      if (diff.issue === 'value_difference') {
        Object.entries(diff.differences).forEach(([field, data]) => {
          console.log(`        ${field}: MySQL=${data.mysql}, MoMo=${data.momo} (diff=${data.diff.toFixed(6)})`);
        });
      }
    });
  } else if (differences.length > 10) {
    console.log(`   📋 Demasiadas diferencias para mostrar (${differences.length} total)`);
    
    // Mostrar resumen por tipo
    const byType = differences.reduce((acc, diff) => {
      acc[diff.issue] = (acc[diff.issue] || 0) + 1;
      return acc;
    }, {});
    
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`     ${type}: ${count} casos`);
    });
  }
  
  const status = differences.length === 0 ? 'perfect_match' : 'has_differences';
  return { 
    symbol, 
    status, 
    matches, 
    differences: differences.length,
    mysqlCandles: mysqlData.size,
    momoCandles: momoData.size
  };
}

async function main() {
  console.log('🔍 COMPARADOR EXACTO MYSQL vs MOMO');
  console.log('═'.repeat(60));
  
  const targetDate = await getTodayDateET();
  console.log(`📅 Fecha objetivo: ${targetDate}`);
  
  // Obtener símbolos de MySQL para hoy
  const symbols = await getTickersFromMySQL(targetDate);
  
  if (symbols.length === 0) {
    console.log('❌ No hay símbolos en MySQL para hoy');
    return;
  }
  
  console.log(`\n🎯 Comparando ${Math.min(symbols.length, 5)} símbolos (primeros por volumen):`);
  
  // Comparar los primeros 5 símbolos (los que tienen más velas)
  const results = [];
  for (const symbol of symbols.slice(0, 5)) {
    const result = await compareSymbolData(symbol, targetDate);
    results.push(result);
    
    // Pausa para no sobrecargar APIs
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Resumen final
  console.log('\n' + '═'.repeat(60));
  console.log('🎯 RESUMEN FINAL');
  console.log('═'.repeat(60));
  
  results.forEach(r => {
    const status = r.status === 'perfect_match' ? '✅ PERFECT' : 
                  r.matches > 0 ? `⚠️ PARTIAL (${r.matches}/${r.mysqlCandles})` : '❌ NO MATCH';
    console.log(`${r.symbol}: MySQL=${r.mysqlCandles}, MoMo=${r.momoCandles}, Matches=${r.matches}, Diffs=${r.differences} ${status}`);
  });
  
  const perfectMatches = results.filter(r => r.status === 'perfect_match').length;
  const withData = results.filter(r => r.mysqlCandles > 0 && r.momoCandles > 0).length;
  const totalMatches = results.reduce((sum, r) => sum + r.matches, 0);
  const totalCandles = results.reduce((sum, r) => sum + r.mysqlCandles, 0);
  
  console.log('\n📊 ESTADÍSTICAS:');
  console.log(`• Símbolos con datos en ambos: ${withData}/${results.length}`);
  console.log(`• Coincidencias perfectas: ${perfectMatches}/${results.length}`);
  console.log(`• Total de coincidencias: ${totalMatches}/${totalCandles} velas (${(totalMatches/totalCandles*100).toFixed(1)}%)`);
  
  if (perfectMatches === results.length) {
    console.log('\n🎉 ¡TODOS LOS DATOS COINCIDEN PERFECTAMENTE!');
  } else if (totalMatches / totalCandles > 0.9) {
    console.log('\n👍 Sincronización muy buena (>90% coincidencias)');
  } else if (totalMatches / totalCandles > 0.7) {
    console.log('\n⚠️ Sincronización aceptable (70-90% coincidencias)');
  } else {
    console.log('\n❌ Problemas de sincronización detectados (<70% coincidencias)');
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  main().catch(console.error);
}