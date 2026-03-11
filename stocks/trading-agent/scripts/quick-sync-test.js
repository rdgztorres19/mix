#!/usr/bin/env node

/**
 * Data Sync Quick Test
 * 
 * Prueba rápida de conectividad y datos básicos
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

async function testMySQLConnection() {
  console.log('🔌 Testing MySQL connection...');
  try {
    const pool = mysql.createPool(MYSQL_CONFIG);
    const [rows] = await pool.query('SELECT COUNT(*) as count FROM training_1m WHERE date = ?', [await getTodayDateET()]);
    console.log(`✅ MySQL OK - ${rows[0].count} records para hoy`);
    
    // Test symbols today
    const [symbols] = await pool.query('SELECT DISTINCT symbol FROM training_1m WHERE date = ? ORDER BY symbol', [await getTodayDateET()]);
    console.log(`📋 Símbolos en MySQL hoy: ${symbols.slice(0, 5).map(r => r.symbol).join(', ')}${symbols.length > 5 ? '...' : ''} (${symbols.length} total)`);
    
    await pool.end();
    return symbols.map(r => r.symbol);
  } catch (error) {
    console.error('❌ MySQL Error:', error.message);
    return [];
  }
}

async function testMoMoAPI() {
  console.log('🌐 Testing MoMo API...');
  try {
    const testSymbol = 'AAPL'; // Un símbolo que seguro existe
    const url = `${MOMO_BASE}/ticker/chart?q=${testSymbol}&interval=1m`;
    const response = await axios.get(url, { timeout: 10000 });
    
    if (response.data?.error === 0 && response.data?.message?.history) {
      const history = response.data.message.history;
      console.log(`✅ MoMo API OK - ${history.length} velas para ${testSymbol}`);
      
      // Test fecha filtro
      const todayET = await getTodayDateET();
      const todayCandles = history.filter(([o, h, l, c, v, t]) => {
        const candleDate = new Date(t * 1000).toLocaleDateString('en-CA', { 
          timeZone: 'America/New_York' 
        });
        return candleDate === todayET;
      });
      console.log(`📅 Velas de hoy para ${testSymbol}: ${todayCandles.length}`);
      
      return true;
    } else {
      console.log('⚠️ MoMo API: No data received');
      return false;
    }
  } catch (error) {
    console.error('❌ MoMo API Error:', error.message);
    return false;
  }
}

async function testBackendAPI() {
  console.log('🚀 Testing Backend API...');
  try {
    const response = await axios.get(`${BACKEND_BASE}/collector/status`, { timeout: 5000 });
    console.log(`✅ Backend API OK - ${response.data.activeSymbols?.length || 0} active symbols`);
    console.log(`📊 Active: ${response.data.activeSymbols?.slice(0, 3).join(', ') || 'none'}${(response.data.activeSymbols?.length || 0) > 3 ? '...' : ''}`);
    return response.data.activeSymbols || [];
  } catch (error) {
    console.error('❌ Backend API Error:', error.message);
    return [];
  }
}

async function compareSymbolData(symbol) {
  console.log(`\n🔍 Testing ${symbol}:`);
  const todayET = await getTodayDateET();
  
  try {
    // MySQL data
    const pool = mysql.createPool(MYSQL_CONFIG);
    const [mysqlRows] = await pool.query(
      'SELECT COUNT(*) as count FROM training_1m WHERE symbol = ? AND date = ?',
      [symbol, todayET]
    );
    console.log(`   📊 MySQL: ${mysqlRows[0].count} velas`);
    
    // Latest MySQL candle
    const [latest] = await pool.query(
      'SELECT candle_time_et, close FROM training_1m WHERE symbol = ? AND date = ? ORDER BY candle_time_et DESC LIMIT 1',
      [symbol, todayET]
    );
    
    if (latest.length > 0) {
      console.log(`   ⏰ Última vela MySQL: ${latest[0].candle_time_et} @ $${latest[0].close}`);
    }
    
    await pool.end();
    
    // MoMo data
    const url = `${MOMO_BASE}/ticker/chart?q=${symbol}&interval=1m`;
    const response = await axios.get(url, { timeout: 8000 });
    
    if (response.data?.error === 0 && response.data?.message?.history) {
      const allCandles = response.data.message.history;
      const todayCandles = allCandles.filter(([o, h, l, c, v, t]) => {
        const candleDate = new Date(t * 1000).toLocaleDateString('en-CA', { 
          timeZone: 'America/New_York' 
        });
        return candleDate === todayET;
      });
      
      console.log(`   🌐 MoMo: ${todayCandles.length} velas para hoy`);
      
      if (todayCandles.length > 0) {
        const lastCandle = todayCandles[todayCandles.length - 1];
        const lastTime = new Date(lastCandle[5] * 1000).toLocaleTimeString('en-US', {
          timeZone: 'America/New_York',
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        });
        console.log(`   ⏰ Última vela MoMo: ${lastTime} @ $${lastCandle[3].toFixed(4)}`);
      }
      
      return {
        mysql: mysqlRows[0].count,
        momo: todayCandles.length
      };
    } else {
      console.log('   ⚠️ Sin datos MoMo');
      return { mysql: mysqlRows[0].count, momo: 0 };
    }
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return { mysql: 0, momo: 0 };
  }
}

async function main() {
  console.log('🧪 QUICK DATA SYNC TEST');
  console.log('='.repeat(50));
  console.log(`📅 Testing for date: ${await getTodayDateET()}`);
  
  // Test all connections
  const mysqlSymbols = await testMySQLConnection();
  console.log(''); // spacer
  
  const momoOK = await testMoMoAPI();
  console.log(''); // spacer
  
  const backendSymbols = await testBackendAPI();
  console.log(''); // spacer
  
  if (mysqlSymbols.length === 0) {
    console.log('❌ No hay datos MySQL para hoy - el sistema collector no está guardando datos');
    return;
  }
  
  if (!momoOK) {
    console.log('❌ API MoMo no responde - problema de conectividad');
    return;
  }
  
  if (backendSymbols.length === 0) {
    console.log('❌ Backend no tiene símbolos activos');
    return;
  }
  
  // Test a few symbols in detail
  const testSymbols = backendSymbols.slice(0, 3);
  console.log(`🔍 Testing data sync for: ${testSymbols.join(', ')}`);
  
  const results = [];
  for (const symbol of testSymbols) {
    const result = await compareSymbolData(symbol);
    results.push({ symbol, ...result });
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('🎯 SUMMARY');
  console.log('='.repeat(50));
  
  results.forEach(r => {
    const status = r.mysql === r.momo ? '✅ MATCH' : 
                  r.mysql > 0 && r.momo > 0 ? '⚠️ DIFF' : '❌ MISSING';
    console.log(`${r.symbol}: MySQL=${r.mysql}, MoMo=${r.momo} ${status}`);
  });
  
  const matches = results.filter(r => r.mysql === r.momo).length;
  console.log(`\n🏆 ${matches}/${results.length} symbols perfectly matched`);
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };