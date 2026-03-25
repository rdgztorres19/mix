import axios from 'axios';

export async function fetchAlpacaSnapshotsBatch(symbols: string[], apiKey: string, apiSecret: string) {
  const url = 'https://data.alpaca.markets/v2/stocks/snapshots';
  const params = {
    symbols: symbols.join(','),
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
