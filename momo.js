const fetch = require('node-fetch');

// tu API key de Polygon
const API_KEY = 'YjjQkdGIOlRsQF1ckD_TUd4Y94cMGIDD';

async function getTopGainers() {
  const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/gainers?apiKey=${API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Error HTTP ${res.status}`);

  const data = await res.json();

  // filtramos tickers de $1 a $20
  const gainers = data.tickers
    .filter(t => t.day.close >= 1 && t.day.close <= 20)
    .map(t => ({
      Symbol: t.ticker,
      Price: t.day.close.toFixed(2),
      ChangePct: t.todaysChangePerc.toFixed(2) + '%',
      Volume: t.day.volume,
      DollarVol: (t.day.close * t.day.volume).toFixed(0)
    }));

  // ordenados por % cambio descendente
  gainers.sort((a,b) => parseFloat(b.ChangePct) - parseFloat(a.ChangePct));

  console.table(gainers.slice(0, 20)); // top 20
}

getTopGainers().catch(console.error);