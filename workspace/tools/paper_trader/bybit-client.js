// Bybit API Client
const https = require('https');

const BASE_URL = 'api.bybit.com';

function request(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      port: 443,
      path,
      method: 'GET',
      headers: {
        'User-Agent': 'Node.js',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

function intervalToBybit(interval) {
  if (typeof interval !== 'string') return interval;
  const m = interval.match(/^(\d+)([mhd])$/i);
  if (!m) return interval;

  const value = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();

  if (unit === 'm') return String(value);
  if (unit === 'h') return String(value * 60);
  if (unit === 'd') return 'D';
  return interval;
}

async function getAllTickers() {
  const json = await request('/v5/market/tickers?category=spot');
  if (!json || json.retCode !== 0 || !json.result || !Array.isArray(json.result.list)) {
    const msg = json && json.retMsg ? json.retMsg : 'Unexpected response from Bybit';
    throw new Error(`Bybit tickers error: ${msg}`);
  }
  return json.result.list;
}

async function getKlines(symbol, interval, limit = 100) {
  const bybitInterval = intervalToBybit(interval);
  const path = `/v5/market/kline?category=spot&symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(bybitInterval)}&limit=${encodeURIComponent(limit)}`;
  const json = await request(path);
  if (!json || json.retCode !== 0 || !json.result || !Array.isArray(json.result.list)) {
    const msg = json && json.retMsg ? json.retMsg : 'Unexpected response from Bybit';
    throw new Error(`Bybit klines error: ${msg}`);
  }

  return json.result.list
    .slice()
    .reverse()
    .map((k) => [
      Number(k[0]),
      String(k[1]),
      String(k[2]),
      String(k[3]),
      String(k[4]),
      String(k[5]),
    ]);
}

async function getTradablePairs(minVolume = 1000000) {
  const tickers = await getAllTickers();

  return tickers
    .filter((t) => typeof t.symbol === 'string' && t.symbol.endsWith('USDT'))
    .map((t) => {
      const quoteVolume = parseFloat(t.turnover24h ?? t.quoteVolume ?? 0);
      const lastPrice = parseFloat(t.lastPrice ?? t.lastPriceE8 ?? t.last ?? 0);
      const changeFrac = parseFloat(t.price24hPcnt ?? 0);
      const change24h = Number.isFinite(changeFrac) ? changeFrac * 100 : 0;

      return {
        symbol: t.symbol,
        price: lastPrice,
        change24h,
        volume24h: parseFloat(t.volume24h ?? 0),
        quoteVolume,
        high24h: parseFloat(t.highPrice24h ?? 0),
        low24h: parseFloat(t.lowPrice24h ?? 0),
      };
    })
    .filter((t) => Number.isFinite(t.quoteVolume) && t.quoteVolume >= minVolume)
    .sort((a, b) => b.quoteVolume - a.quoteVolume);
}

module.exports = {
  request,
  getAllTickers,
  getKlines,
  getTradablePairs,
};
