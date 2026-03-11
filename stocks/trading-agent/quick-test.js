const axios = require('axios');

const headers = {
  'APCA-API-KEY-ID': 'PKBLVB6V5QWCSU2TLPHJ',
  'APCA-API-SECRET-KEY': 'Vhuk22MepdEauPUtAmxGjfLRoARzwLBiiNvgjpbG'
};

async function quickTest() {
  console.log('🔍 Quick Alpaca test');
  
  try {
    // Test latest quote - esto siempre debería funcionar
    console.log('\n💰 Testing latest quote...');
    const quoteResponse = await axios.get('https://data.alpaca.markets/v2/stocks/AAPL/quotes/latest', {
      params: { feed: 'iex' },
      headers,
      timeout: 10000
    });
    
    if (quoteResponse.data.quote) {
      const q = quoteResponse.data.quote;
      console.log(`✅ AAPL Latest Quote:`);
      console.log(`   Bid: $${q.bp} x ${q.bs}`);  
      console.log(`   Ask: $${q.ap} x ${q.as}`);
      console.log(`   Time: ${new Date(q.t).toLocaleString()}`);
    }
    
  } catch (e) {
    console.log(`❌ Error: ${e.response?.status} - ${e.message}`);
    
    if (e.response?.data) {
      console.log('Response:', e.response.data);
    }
  }
}

quickTest();