#!/usr/bin/env node

/**
 * Data Sync Verification Script
 * 
 * Compara los últimos 10 elementos de cada ticker en MySQL
 * con los datos históricos de MoMo para detectar inconsistencias.
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
const BACKEND_BASE = 'http://localhost:3033';

async function getTodayDateET() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

async function getActiveSymbols() {
  try {
    console.log('🔍 Obteniendo símbolos activos...');
    const response = await axios.get(`${BACKEND_BASE}/collector/status`);
    return response.data.activeSymbols || [];
  } catch (error) {
    console.error('❌ Error obteniendo símbolos activos:', error.message);
    return [];
  }
}

async function getMySQLCandles(pool, symbol, date, limit = 10) {
  try {
    const [rows] = await pool.query(
      `SELECT symbol, date, candle_time_et, open, high, low, close, volume, candle_idx
       FROM training_1m 
       WHERE symbol = ? AND date = ? 
       ORDER BY candle_time_et DESC 
       LIMIT ?`,
      [symbol, date, limit]
    );
    return rows.reverse(); // Devolver en orden cronológico
  } catch (error) {
    console.error(`❌ Error MySQL para ${symbol}:`, error.message);
    return [];
  }
}

async function getMoMoCandles(symbol) {
  try {
    const url = `${MOMO_BASE}/ticker/chart?q=${symbol}&interval=1m`;
    const response = await axios.get(url, { timeout: 10000 });
    
    if (response.data?.error !== 0 || !response.data?.message?.history) {
      return [];
    }

    const raw = response.data.message.history;
    const allCandles = raw.slice().reverse().map(([o, h, l, c, v, t]) => ({ 
      o, h, l, c, v, t: t * 1000 // Convert to milliseconds
    }));

    // Filtrar solo hoy
    const todayET = await getTodayDateET();
    return allCandles.filter(candle => {
      const candleDate = new Date(candle.t).toLocaleDateString('en-CA', { 
        timeZone: 'America/New_York' 
      });
      return candleDate === todayET;
    });
  } catch (error) {
    console.error(`❌ Error MoMo para ${symbol}:`, error.message);
    return [];
  }
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });
}

function compareCandleData(mysqlCandle, momoCandle, tolerance = 0.001) {
  const differences = [];
  
  // Comparar OHLCV con tolerancia
  const fields = [
    { mysql: 'open', momo: 'o', name: 'Open' },
    { mysql: 'high', momo: 'h', name: 'High' },
    { mysql: 'low', momo: 'l', name: 'Low' },
    { mysql: 'close', momo: 'c', name: 'Close' },
    { mysql: 'volume', momo: 'v', name: 'Volume' }
  ];

  for (const field of fields) {
    const mysqlVal = parseFloat(mysqlCandle[field.mysql]);
    const momoVal = parseFloat(momoCandle[field.momo]);
    
    if (field.name === 'Volume') {
      // Para volumen, permitir diferencias mayores
      if (Math.abs(mysqlVal - momoVal) > Math.max(mysqlVal, momoVal) * 0.1) {
        differences.push({
          field: field.name,
          mysql: mysqlVal,
          momo: momoVal,
          diff: Math.abs(mysqlVal - momoVal)
        });
      }
    } else {
      // Para precios, usar tolerancia relativa
      if (Math.abs(mysqlVal - momoVal) > Math.max(mysqlVal, momoVal) * tolerance) {
        differences.push({
          field: field.name,
          mysql: mysqlVal.toFixed(4),
          momo: momoVal.toFixed(4),
          diff: Math.abs(mysqlVal - momoVal).toFixed(4)
        });
      }
    }
  }

  return differences;
}

async function findMatchingMomoCandle(mysqlCandle, momoCandles) {
  const mysqlTime = new Date(`${mysqlCandle.date}T${mysqlCandle.candle_time_et}:00`).getTime();
  
  // Buscar vela de MoMo en la misma ventana de tiempo (±30 segundos)
  const tolerance = 30 * 1000; // 30 segundos
  
  return momoCandles.find(momoCandle => {
    return Math.abs(momoCandle.t - mysqlTime) <= tolerance;
  });
}

async function verifySymbol(pool, symbol) {
  const todayET = await getTodayDateET();
  
  console.log(`\n📊 Verificando ${symbol} para ${todayET}...`);
  
  // Obtener datos de ambas fuentes
  const [mysqlCandles, momoCandles] = await Promise.all([
    getMySQLCandles(pool, symbol, todayET, 10),
    getMoMoCandles(symbol)
  ]);

  if (mysqlCandles.length === 0) {
    console.log(`   ⚠️  Sin datos en MySQL para ${symbol}`);
    return { symbol, status: 'no_mysql_data', differences: 0 };
  }

  if (momoCandles.length === 0) {
    console.log(`   ⚠️  Sin datos en MoMo para ${symbol}`);
    return { symbol, status: 'no_momo_data', differences: 0 };
  }

  console.log(`   📈 MySQL: ${mysqlCandles.length} velas, MoMo: ${momoCandles.length} velas`);

  let matchedCandles = 0;
  let totalDifferences = 0;
  const detailedDiffs = [];

  // Comparar cada vela de MySQL con la correspondiente de MoMo
  for (const mysqlCandle of mysqlCandles.slice(-10)) { // Últimas 10
    const matchingMomoCandle = await findMatchingMomoCandle(mysqlCandle, momoCandles);
    
    if (!matchingMomoCandle) {
      console.log(`   ❌ No encontrada vela MySQL ${mysqlCandle.candle_time_et} en MoMo`);
      continue;
    }

    matchedCandles++;
    const differences = compareCandleData(mysqlCandle, matchingMomoCandle);
    
    if (differences.length > 0) {
      totalDifferences += differences.length;
      detailedDiffs.push({
        time: mysqlCandle.candle_time_et,
        differences
      });
      
      console.log(`   ⚠️  Diferencias en ${mysqlCandle.candle_time_et}:`);
      differences.forEach(diff => {
        console.log(`      ${diff.field}: MySQL=${diff.mysql}, MoMo=${diff.momo} (diff=${diff.diff})`);
      });
    } else {
      console.log(`   ✅ ${mysqlCandle.candle_time_et}: Datos coinciden`);
    }
  }

  const status = totalDifferences === 0 ? 'perfect_match' : 
                matchedCandles === 0 ? 'no_matches' : 'has_differences';

  return {
    symbol,
    status,
    mysqlCandles: mysqlCandles.length,
    momoCandles: momoCandles.length,
    matchedCandles,
    totalDifferences,
    detailedDiffs
  };
}

async function main() {
  console.log('🔍 Verificador de Sincronización de Datos Trading Agent');
  console.log('='*60);
  
  let pool;
  
  try {
    // Crear pool de MySQL
    console.log('🔌 Conectando a MySQL...');
    pool = mysql.createPool({
      host: MYSQL_CONFIG.host,
      port: MYSQL_CONFIG.port,
      user: MYSQL_CONFIG.user,
      password: MYSQL_CONFIG.password,
      database: MYSQL_CONFIG.database,
      waitForConnections: true,
      connectionLimit: 5,
    });
    console.log('✅ Conectado a MySQL');

    // Obtener símbolos activos
    const symbols = await getActiveSymbols();
    
    if (symbols.length === 0) {
      console.log('❌ No se encontraron símbolos activos');
      return;
    }

    console.log(`📋 Verificando ${symbols.length} símbolos: ${symbols.join(', ')}`);

    // Verificar cada símbolo
    const results = [];
    for (const symbol of symbols) {
      const result = await verifySymbol(pool, symbol);
      results.push(result);
      
      // Pequeña pausa para no sobrecargar APIs
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Resumen final
    console.log('\n' + '='*60);
    console.log('📊 RESUMEN DE VERIFICACIÓN');
    console.log('='*60);

    const perfectMatches = results.filter(r => r.status === 'perfect_match');
    const withDifferences = results.filter(r => r.status === 'has_differences');
    const noMatches = results.filter(r => r.status === 'no_matches');
    const noData = results.filter(r => r.status.includes('no_') && r.status !== 'no_matches');

    console.log(`✅ Coincidencias perfectas: ${perfectMatches.length}`);
    console.log(`⚠️  Con diferencias: ${withDifferences.length}`);
    console.log(`❌ Sin coincidencias: ${noMatches.length}`);
    console.log(`📭 Sin datos: ${noData.length}`);

    if (withDifferences.length > 0) {
      console.log('\n🔍 Símbolos con diferencias:');
      withDifferences.forEach(result => {
        console.log(`   ${result.symbol}: ${result.totalDifferences} diferencias en ${result.matchedCandles} velas`);
      });
    }

    if (perfectMatches.length === symbols.length) {
      console.log('\n🎉 ¡Todos los datos están perfectamente sincronizados!');
    } else {
      console.log(`\n⚠️  ${symbols.length - perfectMatches.length} símbolos tienen discrepancias`);
    }

  } catch (error) {
    console.error('❌ Error general:', error.message);
  } finally {
    if (pool) {
      await pool.end();
      console.log('🔌 Desconectado de MySQL');
    }
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };