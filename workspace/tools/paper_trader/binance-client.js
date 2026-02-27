// Binance API Client
const https = require('https');

const BASE_URL = 'api.binance.com';

// Make HTTPS request and return JSON
function request(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      port: 443,
      path: path,
      method: 'GET',
      headers: {
        'User-Agent': 'Node.js',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
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

// Get all 24h ticker data
async function getAllTickers() {
  return await request('/api/v3/ticker/24hr');
}

// Get historical klines for backtesting
async function getKlines(symbol, interval, limit = 100) {
  const path = `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  return await request(path);
}

// Get all USDT pairs with good volume
async function getTradablePairs(minVolume = 1000000) {
  const tickers = await getAllTickers();
  
  return tickers
    .filter(t => t.symbol.endsWith('USDT'))
    .filter(t => parseFloat(t.volume) * parseFloat(t.lastPrice) >= minVolume)
    .map(t => ({
      symbol: t.symbol,
      price: parseFloat(t.lastPrice),
      change24h: parseFloat(t.priceChangePercent),
      volume24h: parseFloat(t.volume),
      quoteVolume: parseFloat(t.quoteVolume),
      high24h: parseFloat(t.highPrice),
      low24h: parseFloat(t.lowPrice),
    }))
    .sort((a, b) => b.quoteVolume - a.quoteVolume);
}

// Get exchange info (to check trading rules)
async function getExchangeInfo() {
  return await request('/api/v3/exchangeInfo');
}

module.exports = {
  request,
  getAllTickers,
  getKlines,
  getTradablePairs,
  getExchangeInfo,
};
