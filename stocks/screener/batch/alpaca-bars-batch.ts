import axios from 'axios';

export async function fetchAlpacaBarsBatch(symbols: string[], apiKey: string, apiSecret: string, start: string, end: string) {
  const url = 'https://data.alpaca.markets/v2/stocks/bars';
  const params = {
    symbols: symbols.join(','),
    timeframe: '1Day',
    start: `${start}T00:00:00Z`,
    end: `${end}T23:59:59Z`,
    adjustment: 'split',
    sort: 'asc',
    limit: 10000,
  };
  const res = await axios.get(url, {
    params,
    headers: {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': apiSecret,
      'accept': 'application/json',
    },
  });
  return res.data;
}
