// news-stream.js
// npm i ws
// APCA_API_KEY_ID=TU_KEY APCA_API_SECRET_KEY=TU_SECRET node news-stream.js

const WebSocket = require('ws');
const yahooFinance = require('yahoo-finance2').default;



// 1.‑ Conexión al WebSocket de noticias
const ws = new WebSocket('wss://stream.data.alpaca.markets/v1beta1/news', {   // :contentReference[oaicite:0]{index=0}
  headers: {
    'APCA-API-KEY-ID': 'PKBLVB6V5QWCSU2TLPHJ',
    'APCA-API-SECRET-KEY': 'Vhuk22MepdEauPUtAmxGjfLRoARzwLBiiNvgjpbG'
  }
});

// 2.‑ Flujo de eventos
ws.on('open', () => console.log('✓ conectado, esperando autenticación…'));

let count = 0;
// Almacén de símbolos rastreados: symbol -> { baselinePrice, baselineTime, currentPrice }
const tracked = new Map();
let updateTimer = null;

function ensureUpdater() {
  if (updateTimer) return;
  updateTimer = setInterval(updateAllPricesAndPrint, 60_000);
}

async function fetchBaselinePrice(symbol) {
  try {
    const quote = await yahooFinance.quote(symbol);
    const price = quote?.regularMarketPrice;
    if (typeof price === 'number') {
      const entry = tracked.get(symbol);
      if (entry) {
        entry.baselinePrice = price;
        printTable();
      }
    }
  } catch (err) {
    console.error(`baseline price error for ${symbol}:`, err?.message || err);
  }
}

function addSymbolFromNews(symbol, createdAt) {
  const clean = (symbol || '').trim().toUpperCase();
  if (!clean) return;
  if (tracked.has(clean)) return; // ya rastreado

  tracked.set(clean, {
    symbol: clean,
    baselinePrice: null,
    baselineTime: createdAt,
    currentPrice: null
  });

  ensureUpdater();
  fetchBaselinePrice(clean);
}

async function updateAllPricesAndPrint() {
  const symbols = Array.from(tracked.keys());
  if (symbols.length === 0) return;
  try {
    const results = await yahooFinance.quote(symbols);
    const list = Array.isArray(results) ? results : [results];
    for (const q of list) {
      const s = q?.symbol?.toUpperCase?.();
      const p = q?.regularMarketPrice;
      if (!s || typeof p !== 'number') continue;
      const entry = tracked.get(s);
      if (entry) entry.currentPrice = p;
    }
    printTable();
  } catch (err) {
    console.error('update prices error:', err?.message || err);
  }
}

function printTable() {
  const rows = Array.from(tracked.values()).map(entry => {
    const base = entry.baselinePrice;
    const curr = entry.currentPrice;
    const pct = (typeof base === 'number' && typeof curr === 'number' && base !== 0)
      ? ((curr - base) / base) * 100
      : null;
    return {
      Symbol: entry.symbol,
      NewsPrice: typeof base === 'number' ? Number(base.toFixed(4)) : null,
      CurrentPrice: typeof curr === 'number' ? Number(curr.toFixed(4)) : null,
      ChangePct: pct === null ? null : Number(pct.toFixed(2))
    };
  });
  // Ordenar por el mayor cambio porcentual (valor absoluto), nulos al final
  rows.sort((a, b) => {
    const ap = a.ChangePct;
    const bp = b.ChangePct;
    if (ap == null && bp == null) return 0;
    if (ap == null) return 1;
    if (bp == null) return -1;
    return Math.abs(bp) - Math.abs(ap);
  });
  if (rows.length) console.table(rows);
}
ws.on('message', raw => {
  let events;

  console.log(JSON.parse(raw));

  try { events = JSON.parse(raw); } catch { console.log(raw); return; }
  count++;

  (Array.isArray(events) ? events : [events]).forEach(ev => {
    // servidor → {T:"success",msg:"authenticated"}
    if (ev.msg === 'authenticated') {
      console.log('✓ autenticado, suscribiendo al feed global…');
      ws.send(JSON.stringify({ action: 'subscribe', news: ['*'] }));          // :contentReference[oaicite:1]{index=1}
      return;
    }

    // mensajes de noticia → T:"n"
    if (ev.T === 'n') {
      console.log(
        `[${ev.created_at}] ${ev.symbols?.join(',') || '-'} → ${ev.headline}`
      );
      const syms = Array.isArray(ev.symbols) ? ev.symbols : [];
      for (const s of syms) addSymbolFromNews(s, ev.created_at);
    }
  });
});

ws.on('error',  console.error);
ws.on('close', () => console.log('socket cerrado'));
