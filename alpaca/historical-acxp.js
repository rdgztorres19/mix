const axios = require('axios');

/**
 * ALPACA HISTORICAL DATA - ACXP
 * Obtiene datos históricos del stock ACXP hasta la fecha actual
 */

// Configuración Alpaca
const ALPACA_KEY_ID = 'PKBLVB6V5QWCSU2TLPHJ';
const ALPACA_SECRET_KEY = 'Vhuk22MepdEauPUtAmxGjfLRoARzwLBiiNvgjpbG';
const BASE_URL = 'https://data.alpaca.markets/v2';

// Símbolo objetivo
const SYMBOL = 'ACXP';

console.log('📊 ALPACA HISTORICAL DATA - Fetching data for', SYMBOL);
console.log('==============================================');

class AlpacaHistorical {
  constructor() {
    this.headers = {
      'APCA-API-KEY-ID': ALPACA_KEY_ID,
      'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
      'Content-Type': 'application/json'
    };
  }

  // Obtener datos de barras (candles) de 1 minuto
  async getBars(symbol, startDate, endDate) {
    try {
      console.log(`🔄 Obteniendo barras de 1 minuto para ${symbol}...`);
      console.log(`📅 Desde: ${startDate.toISOString()}`);
      console.log(`📅 Hasta: ${endDate.toISOString()}`);
      
      const url = `${BASE_URL}/stocks/${symbol}/bars`;
      const params = {
        timeframe: '1Min',
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        limit: 1000,  // Máximo por request
        asof: '',
        feed: 'iex',   // IEX feed (gratis)
        page_token: ''
      };

      const response = await axios.get(url, {
        headers: this.headers,
        params: params
      });

      console.log(`✅ Respuesta recibida - Status: ${response.status}`);
      return response.data;

    } catch (error) {
      console.error('❌ Error obteniendo barras:', error.message);
      if (error.response) {
        console.error('📄 Response data:', error.response.data);
        console.error('📊 Status:', error.response.status);
      }
      throw error;
    }
  }

  // Obtener últimas cotizaciones
  async getLatestQuote(symbol) {
    try {
      console.log(`💰 Obteniendo última cotización para ${symbol}...`);
      
      const url = `${BASE_URL}/stocks/${symbol}/quotes/latest`;
      const params = {
        feed: 'iex'
      };

      const response = await axios.get(url, {
        headers: this.headers,
        params: params
      });

      return response.data;

    } catch (error) {
      console.error('❌ Error obteniendo cotización:', error.message);
      if (error.response) {
        console.error('📄 Response data:', error.response.data);
      }
      return null;
    }
  }

  // Obtener último trade
  async getLatestTrade(symbol) {
    try {
      console.log(`📈 Obteniendo último trade para ${symbol}...`);
      
      const url = `${BASE_URL}/stocks/${symbol}/trades/latest`;
      const params = {
        feed: 'iex'
      };

      const response = await axios.get(url, {
        headers: this.headers,  
        params: params
      });

      return response.data;

    } catch (error) {
      console.error('❌ Error obteniendo último trade:', error.message);
      if (error.response) {
        console.error('📄 Response data:', error.response.data);
      }
      return null;
    }
  }

  // Mostrar resumen de barras
  displayBarsSummary(barsData) {
    if (!barsData || !barsData.bars || barsData.bars.length === 0) {
      console.log('⚠️ No hay datos de barras disponibles');
      return;
    }

    const bars = barsData.bars;
    console.log(`\n📊 RESUMEN DE BARRAS (${bars.length} candles):`);
    console.log('================================================');
    
    // Mostrar primeras 5 barras
    console.log('\n🔝 Primeras 5 barras:');
    bars.slice(0, 5).forEach((bar, index) => {
      const time = new Date(bar.t).toLocaleString();
      const change = ((bar.c - bar.o) / bar.o * 100).toFixed(2);
      const changeEmoji = change >= 0 ? '📈' : '📉';
      
      console.log(`\n${index + 1}. ${time}`);
      console.log(`   O: $${bar.o} | H: $${bar.h} | L: $${bar.l} | C: $${bar.c}`);
      console.log(`   Volume: ${bar.v} | ${changeEmoji} ${change}%`);
    });

    // Mostrar últimas 10 barras en formato tabla
    if (bars.length > 5) {
      console.log('\n🔚 Últimas 10 barras:');
      const lastBars = bars.slice(-10).map((bar, index) => {
        const time = new Date(bar.t).toLocaleString();
        const change = ((bar.c - bar.o) / bar.o * 100).toFixed(2);
        const changeEmoji = change >= 0 ? '📈' : '📉';
        
        return {
          '#': index + 1,
          'Timestamp': time,
          'Open': `$${bar.o}`,
          'High': `$${bar.h}`,
          'Low': `$${bar.l}`,
          'Close': `$${bar.c}`,
          'Volume': bar.v.toLocaleString(),
          'Change': `${changeEmoji} ${change}%`
        };
      });
      
      console.table(lastBars);
    }

    // Estadísticas generales
    const prices = bars.map(b => b.c);
    const volumes = bars.map(b => b.v);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const totalVolume = volumes.reduce((a, b) => a + b, 0);

    console.log(`\n📈 ESTADÍSTICAS:`);
    console.log(`   🔹 Precio mínimo: $${minPrice}`);
    console.log(`   🔸 Precio máximo: $${maxPrice}`);
    console.log(`   📊 Volumen promedio: ${Math.round(avgVolume).toLocaleString()}`);
    console.log(`   📈 Volumen total: ${totalVolume.toLocaleString()}`);
    console.log(`   📅 Período: ${new Date(bars[0].t).toLocaleDateString()} - ${new Date(bars[bars.length-1].t).toLocaleDateString()}`);
  }

  // Mostrar cotización actual
  displayLatestQuote(quoteData) {
    if (!quoteData || !quoteData.quote) {
      console.log('⚠️ No hay datos de cotización disponibles');
      return;
    }

    const quote = quoteData.quote;
    const time = new Date(quote.t).toLocaleString();
    const spread = (quote.ap - quote.bp).toFixed(4);
    const spreadPct = ((quote.ap - quote.bp) / quote.ap * 100).toFixed(3);

    console.log(`\n💰 COTIZACIÓN ACTUAL:`);
    console.log('====================');
    console.log(`⏰ Tiempo: ${time}`);
    console.log(`📉 Bid: $${quote.bp} x ${quote.bs}`);
    console.log(`📈 Ask: $${quote.ap} x ${quote.as}`);
    console.log(`📏 Spread: $${spread} (${spreadPct}%)`);
  }

  // Mostrar último trade
  displayLatestTrade(tradeData) {
    if (!tradeData || !tradeData.trade) {
      console.log('⚠️ No hay datos de trade disponibles');
      return;
    }

    const trade = tradeData.trade;
    const time = new Date(trade.t).toLocaleString();

    console.log(`\n🔥 ÚLTIMO TRADE:`);
    console.log('================');
    console.log(`⏰ Tiempo: ${time}`);
    console.log(`💰 Precio: $${trade.p}`);
    console.log(`📊 Tamaño: ${trade.s} shares`);
    console.log(`🏢 Exchange: ${trade.x || 'N/A'}`);
  }

  // Verificar estado del mercado (aproximado - para US markets)
  getMarketStatus() {
    const now = new Date();
    const easternTime = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}));
    const hour = easternTime.getHours();
    const day = easternTime.getDay(); // 0 = Sunday, 6 = Saturday
    
    // Mercado cerrado los fines de semana
    if (day === 0 || day === 6) {
      return { status: "🔴 CERRADO (Fin de semana)", nextOpen: "Lunes 9:30 AM ET" };
    }
    
    // Horario regular: 9:30 AM - 4:00 PM ET
    if (hour >= 9.5 && hour < 16) {
      return { status: "🟢 ABIERTO (Horario regular)", details: "9:30 AM - 4:00 PM ET" };
    }
    
    // Pre-market: 4:00 AM - 9:30 AM ET
    if (hour >= 4 && hour < 9.5) {
      return { status: "🟡 PRE-MARKET", details: "4:00 AM - 9:30 AM ET" };
    }
    
    // After-hours: 4:00 PM - 8:00 PM ET
    if (hour >= 16 && hour < 20) {
      return { status: "🟡 AFTER-HOURS", details: "4:00 PM - 8:00 PM ET" };
    }
    
    // Mercado cerrado durante la noche
    return { status: "🔴 CERRADO (Noche)", nextOpen: "4:00 AM ET" };
  }

  // Función principal para obtener todos los datos
  async fetchAllData(symbol) {
    try {
      console.log(`\n🚀 Iniciando fetch de datos históricos para ${symbol}...`);
      
      // Definir rango de fechas (última semana para obtener datos suficientes)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7); // 1 semana atrás
      
      console.log(`📅 Obteniendo datos desde: ${startDate.toLocaleString()}`);
      console.log(`📅 Hasta: ${endDate.toLocaleString()}`);
      console.log(`⏰ Hora actual del sistema: ${new Date().toLocaleString()}`);
      
      // Verificar si estamos en horario de mercado
      const marketStatus = this.getMarketStatus();
      console.log(`📊 Estado del mercado: ${marketStatus.status}`);

      // Obtener datos en paralelo
      const [barsData, latestQuote, latestTrade] = await Promise.all([
        this.getBars(symbol, startDate, endDate),
        this.getLatestQuote(symbol),
        this.getLatestTrade(symbol)
      ]);

      // Mostrar resultados
      console.log('\n' + '='.repeat(60));
      console.log(`📊 DATOS HISTÓRICOS PARA ${symbol}`);
      console.log('='.repeat(60));

      this.displayBarsSummary(barsData);
      this.displayLatestQuote(latestQuote);
      this.displayLatestTrade(latestTrade);

      console.log('\n✅ Fetch completado exitosamente');
      
      return {
        bars: barsData,
        quote: latestQuote,
        trade: latestTrade
      };

    } catch (error) {
      console.error('❌ Error en fetchAllData:', error.message);
      throw error;
    }
  }
}

// Ejecutar cuando se corre el script
async function main() {
  const alpaca = new AlpacaHistorical();
  
  try {
    await alpaca.fetchAllData(SYMBOL);
  } catch (error) {
    console.error('💥 Error fatal:', error.message);
    process.exit(1);
  }
}

// Ejecutar solo si es el archivo principal
if (require.main === module) {
  main();
}

module.exports = AlpacaHistorical;