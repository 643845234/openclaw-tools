// Paper Trading Engine - Simulates trades and tracks portfolio
class PaperTradingEngine {
  constructor(config) {
    this.startingCapital = config.startingCapital || 100;
    this.capital = this.startingCapital;
    this.positions = {}; // symbol -> { quantity, avgPrice, invested, openedAt, entryStrategy, entryConsensus, entryScore }
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
      if (currentPrice) {
        positionsValue += position.quantity * currentPrice;
      } else {
        positionsValue += position.quantity * position.avgPrice; // Fallback
      }
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
    
    return (currentPrice - position.avgPrice) * position.quantity;
  }

  // Check if stop loss or take profit should trigger
  checkExitTriggers(symbol, currentPrice) {
    const position = this.positions[symbol];
    if (!position) return null;
    
    const pnlPercent = (currentPrice - position.avgPrice) / position.avgPrice;
    
    if (pnlPercent <= -this.stopLossPercent) {
      return { type: 'STOP_LOSS', reason: `Stop loss hit: ${(pnlPercent * 100).toFixed(2)}%` };
    }
    
    if (pnlPercent >= this.takeProfitPercent) {
      return { type: 'TAKE_PROFIT', reason: `Take profit hit: ${(pnlPercent * 100).toFixed(2)}%` };
    }
    
    return null;
  }

  // Execute a buy order
  buy(symbol, price, timestamp, signalStrength = 1, meta = {}) {
    if (this.capital <= 0) {
      return { success: false, error: 'Insufficient capital', capital: this.capital };
    }

    // Calculate position size (more confident = larger position)
    const maxPosition = this.getPortfolioValue({ [symbol]: price }).totalValue * this.maxPositionSize;
    const tradeSize = Math.min(maxPosition, this.capital * signalStrength);
    
    // Minimum trade size check
    if (tradeSize < 10) {
      return { success: false, error: 'Trade too small', tradeSize, minTradeSize: 10 };
    }

    const quantity = tradeSize / price;
    
    // Update position
    if (!this.positions[symbol]) {
      this.positions[symbol] = {
        quantity: 0,
        avgPrice: 0,
        invested: 0,
        openedAt: timestamp,
        entryStrategy: meta.entryStrategy || null,
        entryConsensus: typeof meta.entryConsensus === 'number' ? meta.entryConsensus : null,
        entryScore: typeof meta.entryScore === 'number' ? meta.entryScore : null,
      };
    }
    
    const position = this.positions[symbol];
    if (!position.openedAt) position.openedAt = timestamp;
    if (meta.entryStrategy) position.entryStrategy = meta.entryStrategy;
    if (typeof meta.entryConsensus === 'number') position.entryConsensus = meta.entryConsensus;
    if (typeof meta.entryScore === 'number') position.entryScore = meta.entryScore;
    const totalCost = position.quantity * position.avgPrice + tradeSize;
    position.quantity += quantity;
    position.avgPrice = totalCost / position.quantity;
    position.invested += tradeSize;
    
    // Deduct capital
    this.capital -= tradeSize;
    
    const trade = {
      type: 'BUY',
      symbol,
      price,
      quantity,
      amount: tradeSize,
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

  // Execute a sell order
  sell(symbol, price, timestamp, reason = 'STRATEGY') {
    const position = this.positions[symbol];
    if (!position || position.quantity <= 0) {
      return { success: false, error: 'No position to sell' };
    }

    const saleValue = position.quantity * price;
    const profit = saleValue - position.invested;
    const profitPercent = (profit / position.invested) * 100;
    const heldMs = position.openedAt ? (timestamp - position.openedAt) : null;
    
    // Move capital back to cash
    this.capital += saleValue;
    
    const trade = {
      type: 'SELL',
      symbol,
      price,
      quantity: position.quantity,
      amount: saleValue,
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
    
    // Clear position
    delete this.positions[symbol];
    
    return {
      success: true,
      trade,
    };
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
      const unrealized = (currentPrice - position.avgPrice) * position.quantity;
      assetPnL.push({
        symbol,
        quantity: position.quantity,
        avgPrice: position.avgPrice,
        currentPrice,
        unrealized,
        unrealizedPercent: (unrealized / position.invested) * 100,
      });
    }
    
    // Analyze closed trades
    const closedTrades = this.tradeHistory.filter(t => t.type === 'SELL');
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
