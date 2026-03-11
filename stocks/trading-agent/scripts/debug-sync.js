const { verifySync, timestampToET, getTodayDateET } = require('./fixed-sync-verification');

/**
 * Debug-focused script with step-by-step verification
 */

async function debugSingleSymbol(symbol) {
  console.log(`\n🐛 === DEBUGGING SINGLE SYMBOL: ${symbol} ===`);
  
  // Enable debug mode
  process.env.DEBUG = 'true';
  process.env.VERBOSE = 'true';
  
  console.log('📅 Current date (ET):', getTodayDateET());
  console.log('🕰️  Current time (local):', new Date().toLocaleString());
  
  try {
    console.log('\n🔄 Running verification...');
    await verifySync([symbol]);
  } catch (error) {
    console.error('❌ Debug failed:', error);
    console.error('Stack trace:', error.stack);
  }
}

async function debugTimestampConversion(timestamp) {
  console.log(`\n🐛 === DEBUGGING TIMESTAMP CONVERSION ===`);
  console.log(`Input timestamp: ${timestamp}`);
  
  const result = timestampToET(timestamp);
  console.log('Converted result:', result);
  
  // Compare with different methods
  const jsDate = new Date(timestamp);
  console.log('JavaScript Date:', jsDate);
  console.log('JavaScript toISOString():', jsDate.toISOString());
  console.log('JavaScript toLocaleDateString(en-CA, NY):', 
    jsDate.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));
    
  return result;
}

async function debugSpecificTime(symbol, targetTime) {
  console.log(`\n🐛 === DEBUGGING SPECIFIC TIME: ${targetTime} ===`);
  
  // This would need the MySQL connection and MoMo data
  // Implementation would go here to check specific candle
}

// Command line interface
if (require.main === module) {
  const cmd = process.argv[2];
  
  switch (cmd) {
    case 'symbol':
      const symbol = process.argv[3] || 'CRCG';
      debugSingleSymbol(symbol).then(() => process.exit(0));
      break;
      
    case 'timestamp':
      const timestamp = parseInt(process.argv[3]) || Date.now();
      debugTimestampConversion(timestamp).then(() => process.exit(0));
      break;
      
    case 'time':
      const sym = process.argv[3] || 'CRCG';
      const time = process.argv[4] || '09:30';
      debugSpecificTime(sym, time).then(() => process.exit(0));
      break;
      
    default:
      console.log(`
🐛 Debug Tool for Sync Verification

Usage:
  node debug-sync.js symbol [SYMBOL]      # Debug specific symbol (default: CRCG)
  node debug-sync.js timestamp [TS]       # Debug timestamp conversion
  node debug-sync.js time [SYMBOL] [TIME] # Debug specific time
  
Examples:
  node debug-sync.js symbol CAMP
  node debug-sync.js timestamp 1710936000000  
  node debug-sync.js time CRCG 09:30
      `);
      process.exit(1);
  }
}

module.exports = {
  debugSingleSymbol,
  debugTimestampConversion,
  debugSpecificTime
};