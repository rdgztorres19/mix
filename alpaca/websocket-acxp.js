const WebSocket = require('ws');

/**
 * ALPACA WEBSOCKET - ACXP Real-time 1m Bars
 */

// Configuración Alpaca
const ALPACA_KEY_ID = 'PKBLVB6V5QWCSU2TLPHJ';
const ALPACA_SECRET_KEY = 'Vhuk22MepdEauPUtAmxGjfLRoARzwLBiiNvgjpbG';

// Premium SIP feed (permisos premium)
const WS_URL = 'wss://stream.data.alpaca.markets/v2/sip';

// Símbolo
const SYMBOL = 'ACXP';

console.log('🚀 ALPACA WEBSOCKET - 1m Bars for', SYMBOL);
console.log('=====================================');

class AlpacaWebSocket {

  constructor() {
    this.ws = null;
  }

  connect() {

    console.log('📡 Conectando a Alpaca WebSocket...');
    this.ws = new WebSocket(WS_URL);

    this.ws.on('open', () => {

      console.log('✅ WebSocket conectado');

      const authMessage = {
        action: 'auth',
        key: ALPACA_KEY_ID,
        secret: ALPACA_SECRET_KEY
      };

      console.log('🔐 Autenticando...');
      this.ws.send(JSON.stringify(authMessage));
    });

    this.ws.on('message', (data) => {

      const messages = JSON.parse(data.toString());

      messages.forEach(msg => {

        // autenticado
        if (msg.T === 'success' && msg.msg === 'authenticated') {

          console.log('🎉 Autenticación exitosa');

          const subscribeMessage = {
            action: 'subscribe',
            bars: [SYMBOL]
          };

          console.log(`📊 Suscribiendo a velas de ${SYMBOL}`);
          this.ws.send(JSON.stringify(subscribeMessage));
        }

        // confirmación
        if (msg.T === 'subscription') {
          console.log('📋 Suscripción confirmada:', msg);
        }

        // vela nueva
        if (msg.T === 'b') {
          this.handleBar(msg);
        }

        // error
        if (msg.T === 'error') {
          console.error('❌ Error del servidor:', msg);
        }

      });

    });

    this.ws.on('close', (code, reason) => {

      console.log(`🔌 WebSocket cerrado - Code: ${code}`);

      setTimeout(() => {
        console.log('🔄 Reconectando...');
        this.connect();
      }, 5000);

    });

    this.ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error.message);
    });

  }

  handleBar(bar) {

    const timestamp = new Date(bar.t).toLocaleTimeString();

    const change = ((bar.c - bar.o) / bar.o * 100).toFixed(2);
    const emoji = change >= 0 ? '📈' : '📉';

    console.log(`

📊 1-MINUTE BAR ${bar.S}
⏰ ${timestamp}

🟢 Open  : $${bar.o}
🔴 High  : $${bar.h}
🟡 Low   : $${bar.l}
⚫ Close : $${bar.c}

📦 Volume: ${bar.v}

${emoji} Change: ${change}%
`);

  }

}

// iniciar
const alpacaWS = new AlpacaWebSocket();
alpacaWS.connect();

// cerrar limpio
process.on('SIGINT', () => {

  console.log('\n👋 Cerrando conexión WebSocket...');

  if (alpacaWS.ws) {
    alpacaWS.ws.close();
  }

  process.exit(0);

});