#!/usr/bin/env node
/**
 * MoMo Screener WebSocket test — raw Engine.IO v4 / Socket.IO v4
 *
 * Usage:
 *   node momo-ws-test.js CAMP              # single ticker
 *   node momo-ws-test.js CAMP LRHC DTCK    # multiple tickers
 *   node momo-ws-test.js                   # default: CAMP
 */

const WebSocket = require('ws');

const TICKERS = process.argv.slice(2);
if (TICKERS.length === 0) TICKERS.push('CAMP');
const URL = 'wss://momoscreener.com/socket.io/?EIO=4&transport=websocket';

// Track which symbols we actually receive data for
const seen = new Set();

let ws;
let pingTimer;

function connect() {
  console.log(`\n🔌 Connecting to MoMo WebSocket...`);
  console.log(`   Tickers: ${TICKERS.join(', ')}  (${TICKERS.length} total)\n`);

  ws = new WebSocket(URL, {
    headers: {
      Origin: 'https://momoscreener.com',
      'User-Agent': 'Mozilla/5.0',
    },
  });

  ws.on('open', () => {
    console.log('✅ WebSocket open — waiting for Engine.IO handshake...');
  });

  ws.on('message', (raw) => {
    const msg = raw.toString();

    // Engine.IO open packet
    if (msg.startsWith('0{')) {
      const handshake = JSON.parse(msg.slice(1));
      console.log('🤝 Engine.IO handshake:', JSON.stringify(handshake));

      const interval = handshake.pingInterval || 25000;
      pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('3');
      }, interval);

      ws.send('40');
      console.log('📤 Sent 40 (namespace connect)');
      return;
    }

    // Engine.IO ping → pong
    if (msg === '2') { ws.send('3'); return; }
    if (msg === '3') return;

    // Socket.IO namespace connect ack
    if (msg.startsWith('40')) {
      const payload = msg.length > 2 ? JSON.parse(msg.slice(2)) : {};
      console.log('✅ Namespace connected:', JSON.stringify(payload));

      // ── Strategy 1: one "livequote" per ticker ──
      for (const t of TICKERS) {
        const sub = JSON.stringify(['livequote', t]);
        ws.send(`42${sub}`);
        console.log(`📤 Sub livequote: ${t}`);
      }

      // ── Strategy 2: try sending array of tickers ──
      if (TICKERS.length > 1) {
        const multi = JSON.stringify(['livequote', TICKERS.join(',')]);
        ws.send(`42${multi}`);
        console.log(`📤 Sub livequote (comma-joined): ${TICKERS.join(',')}`);
      }

      return;
    }

    // Socket.IO event: 42["eventName", { ... }]
    if (msg.startsWith('42')) {
      try {
        const data = JSON.parse(msg.slice(2));
        const event = data[0];
        const body = data[1];
        const ts = new Date().toLocaleTimeString();

        // Compact summary for livequote / livechart
        if (event === 'livequote' && body?.data) {
          for (const item of body.data) {
            const sym = item.symbol || item.live?.symbol || '?';
            const price = item.live?.lastPrice ?? item.quote?.lastPrice ?? '?';
            const vol = item.live?.totalVolume ?? '?';
            seen.add(sym);
            console.log(`  📈 [${ts}] livequote  ${sym.padEnd(6)} $${price}  vol=${vol}`);
          }
          console.log(`     (seen so far: ${[...seen].sort().join(', ')})`);
          return;
        }

        if (event === 'livechart' && body?.data) {
          for (const item of body.data) {
            const sym = item.symbol || item.live?.symbol || '?';
            const price = item.live?.lastPrice ?? '?';
            seen.add(sym);
            console.log(`  📊 [${ts}] livechart  ${sym.padEnd(6)} $${price}`);
          }
          return;
        }

        if (event === '5m3c' && body?.message) {
          const syms = body.message.map(m => m.symbol).join(', ');
          console.log(`  🔥 [${ts}] 5m3c scanner: ${syms}`);
          return;
        }

        if (event === 'halt') {
          console.log(`  ⛔ [${ts}] halt: ${JSON.stringify(body?.message || [])}`);
          return;
        }

        // Everything else — show condensed
        console.log(`\n─── [${ts}] event: "${event}" ───`);
        const str = JSON.stringify(body);
        console.log(str.length > 500 ? str.slice(0, 500) + '…' : str);
      } catch {
        console.log('📩 Raw:', msg.slice(0, 300));
      }
      return;
    }

    console.log('📩 Unknown:', msg.slice(0, 200));
  });

  ws.on('error', (err) => {
    console.error('❌ WS error:', err.message);
  });

  ws.on('close', (code, reason) => {
    clearInterval(pingTimer);
    console.log(`\n🔒 Closed (code=${code}, reason=${reason || 'none'})`);
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Stopping...');
  console.log(`   Tickers that sent data: ${[...seen].sort().join(', ') || 'none'}`);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(`42${JSON.stringify(['stoplivequote'])}`);
    console.log('📤 Sent stoplivequote');
    setTimeout(() => ws.close(), 500);
  }
  setTimeout(() => process.exit(0), 1000);
});

connect();
