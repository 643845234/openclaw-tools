// Strategy Engine with Technical Indicators and Backtesting

// Calculate RSI
function calculateRSI(data, period = 14) {
  if (data.length < period + 1) return null;
  
  let gains = 0, losses = 0;
  
  // Initial average
  for (let i = 1; i <= period; i++) {
    const change = data[i].close - data[i - 1].close;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  // RSI values
  const rsi = [null];
  
  for (let i = period + 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    
    if (avgLoss === 0) {
      rsi.push(100);
      continue;
    }

    const rs = avgGain / avgLoss;
    rsi.push(100 - (100 / (1 + rs)));
  }
  
  return rsi;
}

// Calculate EMA
function calculateEMA(data, period) {
  const k = 2 / (period + 1);
  const ema = [data[0].close];
  
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i].close * k + ema[i - 1] * (1 - k));
  }
  
  return ema;
}

// Calculate MACD
function calculateMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const ema12 = calculateEMA(data, fastPeriod);
  const ema26 = calculateEMA(data, slowPeriod);
  
  const macd = ema12.map((v, i) => v - ema26[i]);
  const signal = calculateEMA(macd.map(v => ({ close: v })), signalPeriod);
  
  return { macd, signal };
}

// Calculate Bollinger Bands
function calculateBollinger(data, period = 20, stdDev = 2) {
  const sma = [];
  const upper = [];
  const lower = [];
  
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const closePrices = slice.map(c => c.close);
    const mean = closePrices.reduce((a, b) => a + b, 0) / period;
    const variance = closePrices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    const sd = Math.sqrt(variance);
    
    sma.push(mean);
    upper.push(mean + (sd * stdDev));
    lower.push(mean - (sd * stdDev));
  }
  
  return { sma, upper, lower };
}

// Strategy 1: RSI Based
// Buy when RSI < 30 (oversold), Sell when RSI > 70 (overbought)
function rsiStrategy(data, params = { oversold: 30, overbought: 70 }) {
  const rsiPeriod = params && params.period ? params.period : 14;
  const rsi = calculateRSI(data, rsiPeriod);
  if (!rsi) return { signal: 'HOLD', score: 0 };
  
  const currentRSI = rsi[rsi.length - 1];
  if (!currentRSI) return { signal: 'HOLD', score: 0 };
  
  if (currentRSI < params.oversold) {
    return { signal: 'BUY', score: (params.oversold - currentRSI) / params.oversold };
  } else if (currentRSI > params.overbought) {
    return { signal: 'SELL', score: (currentRSI - params.overbought) / (100 - params.overbought) };
  }
  
  return { signal: 'HOLD', score: 0 };
}

// Strategy 6: Tom DeMark Sequential (simplified)
// Setup counts when close is higher/lower than close N bars earlier.
// Typical: N=4, setup=9. A completed sell-setup (9 up closes) can indicate exhaustion (SELL),
// a completed buy-setup (9 down closes) can indicate exhaustion (BUY).
function tdSequentialStrategy(data, params = { lookback: 4, setupLength: 9 }) {
  const lookback = params && typeof params.lookback === 'number' ? params.lookback : 4;
  const setupLength = params && typeof params.setupLength === 'number' ? params.setupLength : 9;
  if (!Array.isArray(data) || data.length < lookback + setupLength + 1) {
    return { signal: 'HOLD', score: 0, buySetup: 0, sellSetup: 0 };
  }

  let buySetup = 0;
  let sellSetup = 0;

  for (let i = lookback; i < data.length; i++) {
    const close = data[i].close;
    const prev = data[i - lookback].close;
    if (close > prev) {
      sellSetup += 1;
      buySetup = 0;
    } else if (close < prev) {
      buySetup += 1;
      sellSetup = 0;
    } else {
      buySetup = 0;
      sellSetup = 0;
    }

    if (buySetup > setupLength) buySetup = setupLength;
    if (sellSetup > setupLength) sellSetup = setupLength;
  }

  if (buySetup >= setupLength) {
    return { signal: 'BUY', score: 1, buySetup, sellSetup };
  }

  if (sellSetup >= setupLength) {
    return { signal: 'SELL', score: 1, buySetup, sellSetup };
  }

  // Partial signal: approaching completion
  if (buySetup >= Math.max(6, setupLength - 3)) {
    return { signal: 'BUY', score: buySetup / setupLength, buySetup, sellSetup };
  }
  if (sellSetup >= Math.max(6, setupLength - 3)) {
    return { signal: 'SELL', score: sellSetup / setupLength, buySetup, sellSetup };
  }

  return { signal: 'HOLD', score: 0, buySetup, sellSetup };
}

// Strategy 2: MACD Crossover
// Buy when MACD crosses above signal, Sell when MACD crosses below
function macdStrategy(data, params = { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }) {
  const { macd, signal } = calculateMACD(data, params.fastPeriod, params.slowPeriod, params.signalPeriod);
  if (macd.length < 2) return { signal: 'HOLD', score: 0 };
  
  const current = macd[macd.length - 1] - signal[signal.length - 1];
  const previous = macd[macd.length - 2] - signal[signal.length - 2];
  
  if (previous < 0 && current > 0) {
    return { signal: 'BUY', score: Math.abs(current) };
  } else if (previous > 0 && current < 0) {
    return { signal: 'SELL', score: Math.abs(current) };
  }
  
  return { signal: 'HOLD', score: 0 };
}

// Strategy 3: EMA Crossover
// Buy when short EMA crosses above long EMA
function emaCrossStrategy(data, params = { shortPeriod: 9, longPeriod: 21 }) {
  const emaShort = calculateEMA(data, params.shortPeriod);
  const emaLong = calculateEMA(data, params.longPeriod);
  
  if (emaShort.length < 2) return { signal: 'HOLD', score: 0 };
  
  const currentDiff = emaShort[emaShort.length - 1] - emaLong[emaLong.length - 1];
  const prevDiff = emaShort[emaShort.length - 2] - emaLong[emaLong.length - 2];
  
  if (prevDiff < 0 && currentDiff > 0) {
    return { signal: 'BUY', score: currentDiff / emaLong[emaLong.length - 1] };
  } else if (prevDiff > 0 && currentDiff < 0) {
    return { signal: 'SELL', score: Math.abs(currentDiff) / emaLong[emaLong.length - 1] };
  }
  
  return { signal: 'HOLD', score: 0 };
}

// Strategy 4: Bollinger Band Bounce
// Buy near lower band, Sell near upper band
function bollingerStrategy(data, params = { period: 20, stdDev: 2 }) {
  const bb = calculateBollinger(data, params.period, params.stdDev);
  if (!bb.sma.length) return { signal: 'HOLD', score: 0 };
  
  const currentPrice = data[data.length - 1].close;
  const upper = bb.upper[bb.upper.length - 1];
  const lower = bb.lower[bb.lower.length - 1];
  const sma = bb.sma[bb.sma.length - 1];
  
  const range = upper - lower;
  if (!range) return { signal: 'HOLD', score: 0 };
  const position = (currentPrice - lower) / range; // 0 = lower, 1 = upper
  
  if (position < 0.1) {
    return { signal: 'BUY', score: 0.1 - position }; // Strong buy signal
  } else if (position > 0.9) {
    return { signal: 'SELL', score: position - 0.9 }; // Strong sell signal
  }
  
  return { signal: 'HOLD', score: 0 };
}

// Strategy 5: Momentum (24h change with volume)
// Buy assets showing strong uptrend with volume
function momentumStrategy(pairData) {
  const { change24h, volume24h, quoteVolume } = pairData;
  
  // Strong positive momentum with high volume = buy
  if (change24h > 5 && quoteVolume > 10000000) {
    return { signal: 'BUY', score: change24h / 100 };
  } else if (change24h > 10 && quoteVolume > 5000000) {
    return { signal: 'BUY', score: change24h / 200 };
  }
  
  // Strong drop with high volume = sell
  if (change24h < -10 && quoteVolume > 10000000) {
    return { signal: 'SELL', score: Math.abs(change24h) / 100 };
  }
  
  return { signal: 'HOLD', score: 0 };
}

// Evaluate all strategies and return the best signal
function evaluateStrategies(data, pairData, strategyConfig = {}, strategyWeights = {}) {
  const results = [];
  
  // Try each strategy
  try {
    if (strategyConfig.rsi) {
      results.push({ name: 'RSI', result: rsiStrategy(data, strategyConfig.rsi) });
    } else {
      results.push({ name: 'RSI', result: rsiStrategy(data) });
    }

    if (strategyConfig.macd) {
      const { fastPeriod, slowPeriod, signalPeriod } = strategyConfig.macd;
      results.push({ name: 'MACD', result: macdStrategy(data, { fastPeriod, slowPeriod, signalPeriod }) });
    } else {
      results.push({ name: 'MACD', result: macdStrategy(data) });
    }

    if (strategyConfig.emaCross) {
      results.push({ name: 'EMA Cross', result: emaCrossStrategy(data, strategyConfig.emaCross) });
    } else {
      results.push({ name: 'EMA Cross', result: emaCrossStrategy(data) });
    }

    if (strategyConfig.bollingerBands) {
      results.push({ name: 'Bollinger', result: bollingerStrategy(data, strategyConfig.bollingerBands) });
    } else {
      results.push({ name: 'Bollinger', result: bollingerStrategy(data) });
    }

    results.push({ name: 'Momentum', result: momentumStrategy(pairData) });

    if (strategyConfig.tdSequential) {
      results.push({ name: 'TD Sequential', result: tdSequentialStrategy(data, strategyConfig.tdSequential) });
    } else {
      results.push({ name: 'TD Sequential', result: tdSequentialStrategy(data) });
    }
  } catch (e) {
    console.error('Strategy evaluation error:', e.message);
  }

  // Apply learned weights (bias) to scores
  for (const r of results) {
    const w = strategyWeights && typeof strategyWeights[r.name] === 'number' ? strategyWeights[r.name] : 1;
    if (r && r.result && typeof r.result.score === 'number' && Number.isFinite(w)) {
      r.result.score *= w;
      r.result.weight = w;
    }
  }
  
  // Find consensus (same signal from multiple strategies)
  const buys = results.filter(r => r.result.signal === 'BUY');
  const sells = results.filter(r => r.result.signal === 'SELL');
  
  // Return the strongest signal
  if (buys.length >= 2 && buys.length > sells.length) {
    const best = buys.sort((a, b) => b.result.score - a.result.score)[0];
    return { ...best.result, consensus: buys.length, strategy: best.name };
  } else if (sells.length >= 2 && sells.length > buys.length) {
    const best = sells.sort((a, b) => b.result.score - a.result.score)[0];
    return { ...best.result, consensus: sells.length, strategy: best.name };
  }
  
  // No consensus - highest confidence single signal
  const allSignals = results.filter(r => r.result.signal !== 'HOLD');
  if (allSignals.length > 0) {
    const best = allSignals.sort((a, b) => b.result.score - a.result.score)[0];
    return { ...best.result, consensus: 1, strategy: best.name };
  }
  
  return { signal: 'HOLD', score: 0, consensus: 0, strategy: 'None' };
}

module.exports = {
  calculateRSI,
  calculateEMA,
  calculateMACD,
  calculateBollinger,
  rsiStrategy,
  macdStrategy,
  emaCrossStrategy,
  bollingerStrategy,
  momentumStrategy,
  tdSequentialStrategy,
  evaluateStrategies,
};
