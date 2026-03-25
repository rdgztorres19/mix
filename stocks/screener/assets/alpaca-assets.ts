import axios from 'axios';

export interface AlpacaAsset {
  id: string;
  class: string;
  exchange: string;
  symbol: string;
  name: string;
  status: string;
  tradable: boolean;
}

export async function fetchAlpacaAssets(apiKey: string, apiSecret: string): Promise<AlpacaAsset[]> {
  const url = 'https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity';
  const res = await axios.get(url, {
    headers: {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': apiSecret,
      'accept': 'application/json',
    },
  });
  return res.data as AlpacaAsset[];
}
