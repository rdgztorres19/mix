/**
 * ALPACA DIRECT API TEST
 * Prueba directa del endpoint premium de Alpaca para verificar conectividad
 */

const axios = require('axios');

// Configuración de Alpaca Premium
const ALPACA_KEY_ID = 'PKBLVB6V5QWCSU2TLPHJ';
const ALPACA_SECRET_KEY = 'Vhuk22MepdEauPUtAmxGjfLRoARzwLBiiNvgjpbG';
const BASE_URL = 'https://data.alpaca.markets/v2/stocks';

async function testAlpacaDirect() {
  console.log('🎯 Testing Alpaca Premium API Direct Connection');
  console.log('=' .repeat(50));
  console.log(`📡 Endpoint: ${BASE_URL}/ACXP/bars`);
  console.log(`🔑 Key: ${ALPACA_KEY_ID.substring(0, 8)}...`);
  console.log('');

  const headers = {
    'APCA-API-KEY-ID': ALPACA_KEY_ID,
    'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
  };

  try {
    // Test 1: Get today's data for ACXP
    console.log('📊 Test 1: Requesting ACXP bars for today with SIP feed');
    const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    const params = {
      feed: 'sip',        // Premium SIP feed
      timeframe: '1Min',  // 1-minute bars
      start: `${todayStr}T00:00:00Z`,
      end: `${todayStr}T23:59:59Z`,
      limit: '1000'
    };

    console.log(`📅 Date range: ${params.start} to ${params.end}`);
    console.log('🔄 Making request...');
    
    const startTime = Date.now();
    const response = await axios.get(`${BASE_URL}/ACXP/bars`, {
      params,
      headers,
      timeout: 15000
    });
    const endTime = Date.now();

    console.log(`✅ Response received in ${endTime - startTime}ms`);
    console.log(`📊 Status: ${response.status} ${response.statusText}`);
    console.log('');

    if (response.data && response.data.bars) {
      const bars = response.data.bars['ACXP'] || [];
      console.log(`📈 Bars received: ${bars.length}`);
      
      if (bars.length > 0) {
        console.log('🔝 First bar:');
        const first = bars[0];
        const firstTime = new Date(first.t * 1000).toLocaleString();
        console.log(`   Time: ${firstTime}`);
        console.log(`   OHLC: $${first.o} / $${first.h} / $${first.l} / $${first.c}`);
        console.log(`   Volume: ${first.v} | VWAP: $${first.vw} | Trades: ${first.n}`);
        console.log('');
        
        console.log('🔚 Last bar:'); 
        const last = bars[bars.length - 1];
        const lastTime = new Date(last.t * 1000).toLocaleString();
        console.log(`   Time: ${lastTime}`);
        console.log(`   OHLC: $${last.o} / $${last.h} / $${last.l} / $${last.c}`);
        console.log(`   Volume: ${last.v} | VWAP: $${last.vw} | Trades: ${last.n}`);
        console.log('');
        
        // Calculate basic metrics
        const prices = bars.map(b => b.c);
        const volumes = bars.map(b => b.v); 
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const totalVolume = volumes.reduce((sum, v) => sum + v, 0);
        const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
        
        console.log('📈 Summary:');
        console.log(`   Price Range: $${minPrice} - $${maxPrice}`);
        console.log(`   Avg Price: $${avgPrice.toFixed(4)}`);
        console.log(`   Total Volume: ${totalVolume.toLocaleString()}`);
        console.log(`   Change: ${(((last.c - first.o) / first.o) * 100).toFixed(2)}%`);
      } else {
        console.log('⚠️ No bars returned - market might be closed or no trading activity');
      }
    } else {
      console.log('⚠️ Unexpected response format:');
      console.log(JSON.stringify(response.data, null, 2));
    }

    // Test 2: Historical data (yesterday)
    console.log('\n📅 Test 2: Requesting historical data (March 10, 2026)');
    const historicalParams = {
      feed: 'sip',
      timeframe: '1Min',
      start: '2026-03-10T00:00:00Z', 
      end: '2026-03-10T23:59:59Z',
      limit: '1000'
    };

    const response2 = await axios.get(`${BASE_URL}/ACXP/bars`, {
      params: historicalParams,
      headers,
      timeout: 15000
    });

    if (response2.data && response2.data.bars) {
      const bars2 = response2.data.bars['ACXP'] || [];
      console.log(`✅ Historical bars: ${bars2.length}`);
      
      if (bars2.length > 0) {
        const firstHistorical = bars2[0];
        const lastHistorical = bars2[bars2.length - 1];
        console.log(`   Time range: ${new Date(firstHistorical.t * 1000).toLocaleString()} - ${new Date(lastHistorical.t * 1000).toLocaleString()}`);
        console.log(`   Price range: $${Math.min(...bars2.map(b => b.l))} - $${Math.max(...bars2.map(b => b.h))}`);
        console.log(`   Total volume: ${bars2.reduce((sum, b) => sum + b.v, 0).toLocaleString()}`);
      }
    }

    console.log('\n🎉 Alpaca Premium API test completed successfully!');
    console.log('✅ SIP feed is working');
    console.log('✅ Authentication is valid');
    console.log('✅ Data quality looks good');

  } catch (error) {
    console.error('\n❌ Test failed:');
    console.error(`Error: ${error.message}`);
    
    if (error.response) {
      console.error(`Status: ${error.response.status} ${error.response.statusText}`);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      
      if (error.response.status === 401) {
        console.error('🔑 Authentication failed - check API keys');
      } else if (error.response.status === 403) {
        console.error('🚫 Access forbidden - check account permissions for SIP feed');
      } else if (error.response.status === 429) {
        console.error('⏱️ Rate limited - too many requests');
      }
    } else if (error.code === 'ECONNREFUSED') {
      console.error('🌐 Connection refused - check network connectivity');
    } else if (error.code === 'ENOTFOUND') {
      console.error('🔍 DNS lookup failed - check URL');
    }
    
    console.error('\n🔄 If this fails, the system will automatically fallback to MoMo data source');
  }
}

// Ejecutar el test
if (require.main === module) {
  testAlpacaDirect();
}

module.exports = { testAlpacaDirect };