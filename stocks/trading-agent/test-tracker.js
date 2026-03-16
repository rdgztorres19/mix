const axios = require('axios');

async function test() {
  console.log('Testing Tracker endpoints...');
  try {
    const res = await axios.get('http://localhost:3100/api/scanner-tracker/today');
    console.log('GET /api/scanner-tracker/today : SUCCESS');
    console.log(`Found ${res.data.length} tracked symbols today.`);
    console.log('Sample:', res.data[0]);
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
       console.log('Backend not running locally, skipping API test.');
    } else {
       console.log('Error testing API:', err.message);
    }
  }
}

test();
