// Paper Trading Engine - Simulates trades and tracks portfolio
class PaperTradingEngine {
  constructor(config) {
    this.startingCapital = config.startingCapital || 100;
    this.capital = this.startingCapital;
    this.positions = {}; // symbol -> { side, leverage, quantity, avgPrice, margin, notional, openedAt, entryStrategy, entryConsensus, entryScore }
    this.tradeHistory = [];
    this.startTime = Date.now();
    this.endTime = this.startTime + (config.tradingWindow || 60 * 60 * 1000);
    this.maxPositionSize = config.maxPositionSize || 0.3;
    this.stopLossPercent = config.stopLossPercent || 0.015;
    this.takeProfitPercent = config.takeProfitPercent || 0.03;
  }

  // Get current portfolio value
  getPortfolioValue(prices) {
    let positionsValue = 0;
    
    for (const [symbol, position] of Object.entries(this.positions)) {
      const currentPrice = prices[symbol];
      const price = currentPrice || position.avgPrice;
      const unreal = this.getUnrealizedPnL(symbol, price);
      positionsValue += (position.margin || 0) + unreal;
    }
    
    return {
      cash: this.capital,
      positionsValue,
      totalValue: this.capital + positionsValue,
      positionsCount: Object.keys(this.positions).length,
    };
  }

  // Calculate unrealized P&L for a position
  getUnrealizedPnL(symbol, currentPrice) {
    const position = this.positions[symbol];
    if (!position) return 0;

    if (position.side === 'SHORT') {
      return (position.avgPrice - currentPrice) * position.quantity;
    }

    return (currentPrice - position.avgPrice) * position.quantity;
  }

  // Check if stop loss or take profit should trigger
  checkExitTriggers(symbol, currentPrice) {
    const position = this.positions[symbol];
    if (!position) return null;

    const rawMove = position.side === 'SHORT'
      ? (position.avgPrice - currentPrice) / position.avgPrice
      : (currentPrice - position.avgPrice) / position.avgPrice;
    const lev = typeof position.leverage === 'number' && Number.isFinite(position.leverage) ? position.leverage : 1;
    const pnlPercent = rawMove * lev;

    if (pnlPercent <= -this.stopLossPercent) {
      return { type: 'STOP_LOSS', reason: `Stop loss hit: ${(pnlPercent * 100).toFixed(2)}%` };
    }
    
    if (pnlPercent >= this.takeProfitPercent) {
      return { type: 'TAKE_PROFIT', reason: `Take profit hit: ${(pnlPercent * 100).toFixed(2)}%` };
    }
    
    return null;
  }

  open(symbol, side, price, timestamp, signalStrength = 1, meta = {}) {
    if (this.capital <= 0) {
      return { success: false, error: 'Insufficient capital', capital: this.capital };
    }

    const leverage = typeof meta.leverage === 'number' && Number.isFinite(meta.leverage) ? meta.leverage : 1;
    const positionSide = side === 'SHORT' ? 'SHORT' : 'LONG';

    const maxMargin = this.getPortfolioValue({ [symbol]: price }).totalValue * this.maxPositionSize;
    const margin = Math.min(maxMargin, this.capital * signalStrength);

    if (margin < 10) {
      return { success: false, error: 'Trade too small', tradeSize: margin, minTradeSize: 10 };
    }

    const notional = margin * leverage;
    const quantity = notional / price;

    if (!this.positions[symbol]) {
      this.positions[symbol] = {
        side: positionSide,
        leverage,
        quantity: 0,
        avgPrice: 0,
        margin: 0,
        notional: 0,
        openedAt: timestamp,
        entryStrategy: meta.entryStrategy || null,
        entryConsensus: typeof meta.entryConsensus === 'number' ? meta.entryConsensus : null,
        entryScore: typeof meta.entryScore === 'number' ? meta.entryScore : null,
      };
    }

    const position = this.positions[symbol];
    if (position.side !== positionSide) {
      return { success: false, error: 'Opposite position exists' };
    }
    if (position.leverage !== leverage) {
      return { success: false, error: 'Leverage mismatch' };
    }

    if (!position.openedAt) position.openedAt = timestamp;
    if (meta.entryStrategy) position.entryStrategy = meta.entryStrategy;
    if (typeof meta.entryConsensus === 'number') position.entryConsensus = meta.entryConsensus;
    if (typeof meta.entryScore === 'number') position.entryScore = meta.entryScore;

    const totalNotional = position.notional + notional;
    position.quantity += quantity;
    position.notional = totalNotional;
    position.margin += margin;
    position.avgPrice = position.quantity > 0 ? (position.notional / position.quantity) : price;

    this.capital -= margin;

    const trade = {
      type: positionSide === 'LONG' ? 'BUY' : 'SELL',
      positionAction: 'OPEN',
      side: positionSide,
      leverage,
      symbol,
      price,
      quantity,
      amount: margin,
      notional,
      timestamp,
      entryStrategy: position.entryStrategy,
      entryConsensus: position.entryConsensus,
      entryScore: position.entryScore,
      remainingCash: this.capital,
    };

    this.tradeHistory.push(trade);

    return {
      success: true,
      trade,
      position,
    };
  }

  close(symbol, price, timestamp, reason = 'STRATEGY') {
    const position = this.positions[symbol];
    if (!position || position.quantity <= 0) {
      return { success: false, error: 'No position to close' };
    }

    const profit = this.getUnrealizedPnL(symbol, price);
    const profitPercent = position.margin ? (profit / position.margin) * 100 : 0;
    const heldMs = position.openedAt ? (timestamp - position.openedAt) : null;
    const release = (position.margin || 0) + profit;
    this.capital += release;

    const trade = {
      type: position.side === 'LONG' ? 'SELL' : 'BUY',
      positionAction: 'CLOSE',
      side: position.side,
      leverage: position.leverage,
      symbol,
      price,
      quantity: position.quantity,
      amount: release,
      profit,
      profitPercent,
      reason,
      timestamp,
      heldMs,
      entryStrategy: position.entryStrategy,
      entryConsensus: position.entryConsensus,
      entryScore: position.entryScore,
      remainingCash: this.capital,
    };

    this.tradeHistory.push(trade);
    delete this.positions[symbol];

    return {
      success: true,
      trade,
    };
  }

  // Execute a buy order
  buy(symbol, price, timestamp, signalStrength = 1, meta = {}) {
    return this.open(symbol, 'LONG', price, timestamp, signalStrength, meta);
  }

  // Execute a sell order
  sell(symbol, price, timestamp, reason = 'STRATEGY') {
    return this.close(symbol, price, timestamp, reason);
  }

  // Check if trading window is complete
  isComplete() {
    return Date.now() >= this.endTime;
  }

  // Get remaining time in trading window
  getRemainingTime() {
    const remaining = this.endTime - Date.now();
    return Math.max(0, remaining);
  }

  // Generate performance summary
  getSummary(prices) {
    const portfolio = this.getPortfolioValue(prices);
    const totalReturn = portfolio.totalValue - this.startingCapital;
    const returnPercent = (totalReturn / this.startingCapital) * 100;
    
    // Calculate per-asset P&L
    const assetPnL = [];
    for (const [symbol, position] of Object.entries(this.positions)) {
      const currentPrice = prices[symbol] || position.avgPrice;
      const unrealized = this.getUnrealizedPnL(symbol, currentPrice);
      assetPnL.push({
        symbol,
        side: position.side,
        leverage: position.leverage,
        quantity: position.quantity,
        avgPrice: position.avgPrice,
        currentPrice,
        unrealized,
        unrealizedPercent: position.margin ? (unrealized / position.margin) * 100 : 0,
      });
    }
    
    // Analyze closed trades
    const closedTrades = this.tradeHistory.filter(t => t.positionAction === 'CLOSE');
    const wins = closedTrades.filter(t => t.profit > 0);
    const losses = closedTrades.filter(t => t.profit <= 0);
    
    return {
      startingCapital: this.startingCapital,
      totalValue: portfolio.totalValue,
      cash: portfolio.cash,
      positionsValue: portfolio.positionsValue,
      totalReturn,
      returnPercent,
      tradesCount: this.tradeHistory.length,
      buys: this.tradeHistory.filter(t => t.type === 'BUY').length,
      sells: closedTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0,
      avgWin: wins.length > 0 ? wins.reduce((a, t) => a + t.profit, 0) / wins.length : 0,
      avgLoss: losses.length > 0 ? losses.reduce((a, t) => a + t.profit, 0) / losses.length : 0,
      openPositions: assetPnL,
      recentTrades: this.tradeHistory.slice(-10),
      remainingTime: this.getRemainingTime(),
      isComplete: this.isComplete(),
    };
  }

  // Export state for persistence
  toJSON() {
    return {
      startingCapital: this.startingCapital,
      capital: this.capital,
      positions: this.positions,
      tradeHistory: this.tradeHistory,
      startTime: this.startTime,
      endTime: this.endTime,
    };
  }

  // Restore state from JSON
  static fromJSON(json) {
    const engine = new PaperTradingEngine({
      startingCapital: json.startingCapital,
      tradingWindow: json.endTime - json.startTime,
    });
    
    engine.capital = json.capital;
    engine.positions = json.positions;
    engine.tradeHistory = json.tradeHistory;
    engine.startTime = json.startTime;
    engine.endTime = json.endTime;
    
    return engine;
  }
}

module.exports = PaperTradingEngine;
