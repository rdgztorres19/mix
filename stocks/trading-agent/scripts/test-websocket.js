#!/usr/bin/env node

/**
 * Test script for Alpaca WebSocket integration.
 * Usage: node scripts/test-websocket.js [symbols...]
 * Example: node scripts/test-websocket.js ACXP AAPL
 */

const { AlpacaWebSocketService } = require('../dist/src/websocket/alpaca-websocket.service');
const { ConfigService } = require('@nestjs/config');

class MockConfigService {
  get(key, defaultValue) {
    const config = {
      'ALPACA_KEY_ID': process.env.ALPACA_KEY_ID || 'PKBLVB6V5QWCSU2TLPHJ',
      'ALPACA_SECRET_KEY': process.env.ALPACA_SECRET_KEY || 'Vhuk22MepdEauPUtAmxGjfLRoARzwLBiiNvgjpbG',
      'ALPACA_WEBSOCKET_ENABLED': true,
      'ALPACA_RECONNECT_INTERVAL_MS': 5000,
      'ALPACA_WEBSOCKET_SYMBOLS': process.argv.slice(2).join(',') || 'ACXP',
    };
    return config[key] !== undefined ? config[key] : defaultValue;
  }
}

async function testWebSocket() {
  console.log('🚀 Testing Alpaca WebSocket Integration');
  console.log('=====================================');
  
  const symbols = process.argv.slice(2);
  if (symbols.length === 0) {
    symbols.push('ACXP');
  }
  
  console.log(`📊 Testing symbols: [${symbols.join(', ')}]`);
  
  const configService = new MockConfigService();
  const alpacaWS = new AlpacaWebSocketService(configService);
  
  // Register bar callback
  alpacaWS.onBar((bar) => {
    const timestamp = new Date(bar.timestamp * 1000).toLocaleTimeString();
    const change = ((bar.close - bar.open) / bar.open * 100).toFixed(2);
    const emoji = parseFloat(change) >= 0 ? '📈' : '📉';
    
    console.log(`
🎯 REAL-TIME BAR RECEIVED
📊 ${bar.symbol} @ ${timestamp}
💰 $${bar.open} → $${bar.close} (${emoji} ${change}%)
📦 Volume: ${bar.volume}
    `);
  });
  
  try {
    // Connect and subscribe
    await alpacaWS.connect();
    
    // Wait a bit for authentication
    setTimeout(async () => {
      if (alpacaWS.isConnected()) {
        console.log(`✅ Connected! Subscribing to: [${symbols.join(', ')}]`);
        await alpacaWS.subscribe(symbols);
      } else {
        console.log('❌ Failed to connect or authenticate');
      }
    }, 2000);
    
    // Keep running
    console.log('⏳ Waiting for real-time data... (Ctrl+C to exit)');
    
  } catch (error) {
    console.error('❌ WebSocket test failed:', error.message);
    process.exit(1);
  }
}

// Clean shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down WebSocket test...');
  process.exit(0);
});

testWebSocket();