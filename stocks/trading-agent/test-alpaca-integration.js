/**
 * ALPACA PREMIUM TEST SCRIPT
 * Prueba la integración de AlpacaDataSource con cache, retry y fallback
 */

import { ConfigService } from '@nestjs/config';
import { AlpacaDataSource } from '../src/scanner/datasource/alpaca-datasource';
import { MomoDataSource } from '../src/scanner/datasource/momo-datasource'; 
import { ScannerService } from '../src/scanner/scanner.service';

// Mock ConfigService 
class MockConfigService {
  get(key: string, fallback?: string): string | undefined {
    // Usar las credenciales que están por defecto
    return fallback;
  }
}

// Mock ScannerService para MomoDataSource
class MockScannerService {
  async getStockSnapshotFromMomo(ticker: string, cutoffMs?: number, timeframe?: '1m' | '5m') {
    console.log(`🔄 FALLBACK: Using Momo for ${ticker}`);
    return {
      ticker: ticker.toUpperCase(), 
      price: 2.73,
      vwap: 2.72,
      volume: 1000,
      change_pct: 0.02,
      // ... other mock fields
      candles_1min: [],
      candles_5min: [],
      high_of_day: 2.80,
      low_of_day: 2.65,
      atr: 0.15,
      ema9: null,
      ema20: null,
      vwap_line: [],
      avg_volume: 800,
      relative_volume: 1.25,
      pre_market_high: null
    };
  }
}

async function testAlpacaIntegration() {
  console.log('🚀 Testing Alpaca Premium Integration with ACXP');
  console.log('=' .repeat(50));

  // Setup
  const configService = new MockConfigService() as any;
  const scannerService = new MockScannerService() as any;
  const momoDataSource = new MomoDataSource(scannerService);
  
  const alpacaDataSource = new AlpacaDataSource(configService, momoDataSource);

  try {
    // Test 1: Current data (should use Alpaca)
    console.log('\n📊 Test 1: Current day data for ACXP');
    const snapshot1 = await alpacaDataSource.getStockSnapshot('ACXP', {
      timeframe: '5m'
    });
    
    console.log(`✅ Result: ${snapshot1.ticker} - $${snapshot1.price} | Vol: ${snapshot1.volume.toLocaleString()}`);
    console.log(`   VWAP: $${snapshot1.vwap?.toFixed(4) || 'N/A'} | Change: ${(snapshot1.change_pct * 100).toFixed(2)}%`);
    console.log(`   Data source: ${(snapshot1 as any).dataSource || 'unknown'}`);
    console.log(`   Bars: 1m=${snapshot1.candles_1min.length} | 5m=${snapshot1.candles_5min.length}`);

    // Test 2: Historical data (specific date)  
    console.log('\n📅 Test 2: Historical data for ACXP (2026-03-10)');
    const snapshot2 = await alpacaDataSource.getStockSnapshot('ACXP', {
      date: '2026-03-10',
      timeframe: '1m'
    });
    
    console.log(`✅ Result: ${snapshot2.ticker} - $${snapshot2.price} | Vol: ${snapshot2.volume.toLocaleString()}`);
    console.log(`   VWAP: $${snapshot2.vwap?.toFixed(4) || 'N/A'} | ATR: ${snapshot2.atr.toFixed(3)}`);
    console.log(`   High: $${snapshot2.high_of_day} | Low: $${snapshot2.low_of_day}`);
    console.log(`   Bars: 1m=${snapshot2.candles_1min.length} | 5m=${snapshot2.candles_5min.length}`);

    // Test 3: Test caching (second request should be faster)
    console.log('\n🚀 Test 3: Cache test (re-requesting same data)');
    const startTime = Date.now();
    
    const snapshot3 = await alpacaDataSource.getStockSnapshot('ACXP', {
      date: '2026-03-10',
      timeframe: '5m'
    });
    
    const endTime = Date.now();
    console.log(`✅ Cached request completed in ${endTime - startTime}ms`);
    console.log(`   Result: ${snapshot3.ticker} - $${snapshot3.price} | Bars: ${snapshot3.candles_1min.length}`);

    // Test 4: Test with invalid ticker (should fallback to Momo)
    console.log('\n⚠️ Test 4: Invalid ticker test (should fallback)');
    const snapshot4 = await alpacaDataSource.getStockSnapshot('INVALID_TICKER_XYZ', {
      timeframe: '5m'
    });
    
    console.log(`✅ Fallback result: ${snapshot4.ticker} - $${snapshot4.price}`);

    console.log('\n🎉 All tests completed successfully!'); 
    console.log(`💾 Cache size: ${(alpacaDataSource as any).cache.size} entries`);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Ejecutar los tests
if (require.main === module) {
  testAlpacaIntegration();
}