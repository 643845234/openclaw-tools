// Paper Trader Configuration
module.exports = {
  // Exchange selection
  exchange: 'binance', // 'binance' | 'bybit'

  // Logging / learning
  logging: {
    enabled: true,
    filePath: './paper_trader_sessions.jsonl',
  },
  optimizer: {
    enabled: true,
    minTradesPerStrategy: 5,
    maxWeight: 1.5,
    minWeight: 0.5,
  },

  tuning: {
    enabled: true,
    filePath: './paper_trader_tuning.json',
    step: {
      rsiOversold: 1,
      rsiOverbought: 1,
      stopLossPercent: 0.0025,
      takeProfitPercent: 0.0025,
    },
    bounds: {
      rsiOversold: { min: 10, max: 40 },
      rsiOverbought: { min: 60, max: 90 },
      stopLossPercent: { min: 0.005, max: 0.05 },
      takeProfitPercent: { min: 0.01, max: 0.2 },
    },
  },

  // Trading parameters
  startingCapital: 1000, // $100 USD
  tradingWindow: 7 * 24 * 60 * 60 * 1000, // 1 week in ms
  checkInterval: 60 * 1000, // 1 minute in ms
  
  // Binance API
  binance: {
    baseUrl: 'https://api.binance.com',
    wsUrl: 'wss://stream.binance.com:9443/ws',
  },

  // Bybit API
  bybit: {
    baseUrl: 'https://api.bybit.com',
  },
  
  // Strategy parameters
  strategies: {
    rsi: {
      period: 14,
      oversold: 30,
      overbought: 70,
    },
    macd: {
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
    },
    bollingerBands: {
      period: 20,
      stdDev: 2,
    },
    emaCross: {
      shortPeriod: 9,
      longPeriod: 21,
    },
    tdSequential: {
      lookback: 4,
      setupLength: 9,
    },
  },
  
  // Asset filtering
  minVolume24h: 1000000, // Minimum $1M 24h volume
  quoteAssets: ['USDT'], // Only trade USDT pairs
  
  // Risk management
  maxPositionSize: 0.3, // Max 30% of portfolio in one asset
  stopLossPercent: 0.015, // 1.5% stop loss
  takeProfitPercent: 0.03, // 3% take profit
  
  // Backtesting
  backtestCandles: 1000, // Use last 100 candles for backtesting
  candleInterval: '5m', // 5-minute candles
};
