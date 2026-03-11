const mysql = require('mysql2/promise');

async function checkSymbols() {
  const conn = await mysql.createConnection({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'sbrQp10',
    database: 'stock_training',
  });
  
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  console.log('🔍 Checking symbols for date:', today);
  
  const [rows] = await conn.query(
    'SELECT symbol, COUNT(*) as candle_count FROM training_1m WHERE date = ? GROUP BY symbol ORDER BY candle_count DESC LIMIT 10',
    [today]
  );
  
  if (rows.length === 0) {
    console.log('❌ No data found for today:', today);
    console.log('\n📅 Checking most recent dates available...');
    const [recentRows] = await conn.query(
      'SELECT date, symbol, COUNT(*) as candle_count FROM training_1m GROUP BY date, symbol ORDER BY date DESC, candle_count DESC LIMIT 20'
    );
    console.log('Recent data:');
    recentRows.forEach(row => console.log(`   ${row.date} ${row.symbol}: ${row.candle_count} candles`));
  } else {
    console.log('✅ Symbols with data today:');
    rows.forEach(row => console.log(`   ${row.symbol}: ${row.candle_count} candles`));
  }
  
  await conn.end();
}

checkSymbols().catch(console.error);