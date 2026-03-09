// alphaca-price.js
// Subscribe to real-time trades for a symbol and track price changes.
// Usage:  node alphaca-price.js AAPL
//         node alphaca-price.js AAPL TSLA NVDA

const WebSocket = require('ws');

const API_KEY    = 'PKBLVB6V5QWCSU2TLPHJ';
const API_SECRET = 'Vhuk22MepdEauPUtAmxGjfLRoARzwLBiiNvgjpbG';

// Símbolos desde argumentos (default: SPY)
const symbols = process.argv.slice(2).map(s => s.toUpperCase());
if (!symbols.length) {
  console.log('Usage: node alphaca-price.js SYMBOL [SYMBOL2 ...]');
  process.exit(1);
}

// Almacén: symbol -> { baselinePrice, currentPrice, high, low, trades }
const tracked = new Map();
for (const s of symbols) {
  tracked.set(s, {
    symbol: s,
    baselinePrice: null,
    currentPrice: null,
    high: -Infinity,
    low: Infinity,
    trades: 0,
    lastTime: null,
  });
}

// ─── WebSocket a Alpaca real-time trades (IEX free) ──────────────────────────
const ws = new WebSocket('wss://stream.data.alpaca.markets/v2/iex', {
  headers: {
    'APCA-API-KEY-ID': API_KEY,
    'APCA-API-SECRET-KEY': API_SECRET,
  },
});

ws.on('open', () => console.log('✓ conectado, esperando autenticación…'));

ws.on('message', raw => {
  let events;
  try { events = JSON.parse(raw); } catch { return; }

  for (const ev of (Array.isArray(events) ? events : [events])) {

    // Autenticación exitosa → suscribir a trades
    if (ev.T === 'success' && ev.msg === 'authenticated') {
      console.log(`✓ autenticado, suscribiendo trades: ${symbols.join(', ')}`);
      ws.send(JSON.stringify({ action: 'subscribe', trades: symbols }));
      continue;
    }

    // Confirmación de suscripción
    if (ev.T === 'subscription') {
      console.log('✓ suscrito a:', ev.trades?.join(', ') || '-');
      continue;
    }

    // Trade → T:"t"
    if (ev.T === 't') {
      const sym = (ev.S || '').toUpperCase();
      const price = ev.p;  // precio del trade
      const entry = tracked.get(sym);
      if (!entry || typeof price !== 'number') continue;

      if (entry.baselinePrice === null) entry.baselinePrice = price;
      entry.currentPrice = price;
      if (price > entry.high) entry.high = price;
      if (price < entry.low) entry.low = price;
      entry.trades++;
      entry.lastTime = ev.t; // timestamp

      printTable();
    }
  }
});

ws.on('error', err => console.error('WS error:', err.message));
ws.on('close', () => console.log('socket cerrado'));

// ─── Tabla ───────────────────────────────────────────────────────────────────
function printTable() {
  console.clear();
  console.log(`\n📈 Alpaca Price Tracker — ${new Date().toLocaleTimeString()}\n`);

  const rows = Array.from(tracked.values()).map(e => {
    const base = e.baselinePrice;
    const curr = e.currentPrice;
    const changePct = (base && curr) ? ((curr - base) / base) * 100 : null;
    const highLowRange = (e.high !== -Infinity && e.low !== Infinity)
      ? `${e.low.toFixed(4)} – ${e.high.toFixed(4)}`
      : '-';

    return {
      Symbol:      e.symbol,
      Entrada:     base !== null ? base.toFixed(4) : '-',
      Actual:      curr !== null ? curr.toFixed(4) : '-',
      'Cambio %':  changePct !== null ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%` : '-',
      'P/L $200':  changePct !== null ? `${changePct >= 0 ? '+' : ''}$${(200 * changePct / 100).toFixed(2)}` : '-',
      'Rango':     highLowRange,
      Trades:      e.trades,
    };
  });

  console.table(rows);
}
