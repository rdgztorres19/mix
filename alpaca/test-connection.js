const AlpacaHistorical = require('./historical-acxp');

/**
 * TEST RÁPIDO - Verificar conexión con Alpaca API
 * Prueba básica para confirmar que las credenciales funcionan
 */

console.log('🧪 TEST RÁPIDO - Alpaca API Connection');
console.log('=====================================');

async function quickTest() {
  const alpaca = new AlpacaHistorical();
  
  try {
    // Test 1: Obtener última cotización
    console.log('\n📊 Test 1: Última cotización ACXP...');
    const quote = await alpaca.getLatestQuote('ACXP');
    
    if (quote && quote.quote) {
      console.log('✅ Cotización obtenida exitosamente');
      console.log(`   📈 Ask: $${quote.quote.ap}`);
      console.log(`   📉 Bid: $${quote.quote.bp}`);
    } else {
      console.log('⚠️ No se pudo obtener cotización');
    }

    // Test 2: Obtener último trade
    console.log('\n🔥 Test 2: Último trade ACXP...');
    const trade = await alpaca.getLatestTrade('ACXP');
    
    if (trade && trade.trade) {
      console.log('✅ Trade obtenido exitosamente');
      console.log(`   💰 Precio: $${trade.trade.p}`);
      console.log(`   📊 Volumen: ${trade.trade.s} shares`);
    } else {
      console.log('⚠️ No se pudo obtener último trade');
    }

    // Test 3: Obtener algunas barras (solo 5 para el test)
    console.log('\n📊 Test 3: Barras históricas (muestra pequeña)...');
    const endDate = new Date();
    const startDate = new Date();
    startDate.setHours(startDate.getHours() - 2); // Solo últimas 2 horas

    const bars = await alpaca.getBars('ACXP', startDate, endDate);
    
    if (bars && bars.bars && bars.bars.length > 0) {
      console.log(`✅ ${bars.bars.length} barras obtenidas`);
      const lastBar = bars.bars[bars.bars.length - 1];
      console.log(`   📊 Última barra: $${lastBar.c} (Close)`);
      console.log(`   📈 Volumen: ${lastBar.v}`);
    } else {
      console.log('⚠️ No se obtuvieron barras (normal fuera del horario de mercado)');
    }

    console.log('\n🎉 TEST COMPLETADO - API funcionando correctamente');
    console.log('\n💡 PRÓXIMOS PASOS:');
    console.log('   🚀 Para WebSocket: npm run websocket');
    console.log('   📊 Para histórico completo: npm run historical');

  } catch (error) {
    console.error('\n❌ ERROR EN TEST:', error.message);
    
    if (error.response) {
      console.error('📊 HTTP Status:', error.response.status);
      console.error('📄 Response:', error.response.data);
      
      if (error.response.status === 401) {
        console.error('\n🔐 ERROR DE AUTENTICACIÓN:');
        console.error('   - Verifica las credenciales ALPACA_KEY_ID y ALPACA_SECRET_KEY');
        console.error('   - Asegúrate de que la cuenta Alpaca esté activa');
      } else if (error.response.status === 403) {
        console.error('\n🚫 ERROR DE PERMISOS:');
        console.error('   - Tu cuenta Alpaca podría no tener acceso a market data');
        console.error('   - Verifica el plan de tu cuenta Alpaca');
      }
    }
    
    process.exit(1);
  }
}

// Ejecutar test
if (require.main === module) {
  quickTest();
}