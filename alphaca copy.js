// news-stream.js
// npm i ws
// APCA_API_KEY_ID=TU_KEY APCA_API_SECRET_KEY=TU_SECRET node news-stream.js

const WebSocket = require('ws');



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
ws.on('message', raw => {
  let events;

  try { events = JSON.parse(raw); } catch { console.log(raw); return; }
  count++;
  // console.log(events);
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
      // aquí disparas tu lógica: guardar en DB, enviar a OpenAI, etc.
    }
  });
});

ws.on('error',  console.error);
ws.on('close', () => console.log('socket cerrado'));
