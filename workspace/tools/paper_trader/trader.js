#!/usr/bin/env node
// Paper Trading Bot - Main Entry Point
// Scans Binance, applies strategies, executes simulated trades

const BinanceClient = require('./binance-client');
const BybitClient = require('./bybit-client');
const StrategyEngine = require('./strategy-engine');
const PaperEngine = require('./paper-engine');
const config = require('./config');
const TelegramReporter = require('./telegram-reporter');
const SessionLogger = require('./session-logger');
const StrategyOptimizer = require('./strategy-optimizer');
const ParamTuner = require('./param-tuner');

// Helper function to send messages to the agent
function agentMessage(type, payload) {
  console.log(JSON.stringify({ type, ...payload }));
}

async function asyncPool(limit, items, iteratorFn) {
  const ret = [];
  const executing = new Set();

  for (const item of items) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    ret.push(p);
    executing.add(p);

    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.allSettled(ret);
}

class PaperTrader {
  constructor() {
    this.paperEngine = null;
    this.running = false;
    this.cycleCount = 0;
    this.prices = {}; // Current prices cache
    this.pairErrors = {};

    this._sleepTimer = null;

    this.marketClient = config.exchange === 'bybit' ? BybitClient : BinanceClient;

    this.logger = new SessionLogger(config.logging);
    this.strategyWeights = {};
    this.tunedConfig = null;
  }

  async initialize() {
    agentMessage('log', { message: '🚀 Paper Trader Initializing...' });
    const cfg = this.tunedConfig || config;
    agentMessage('log', { message: `🏦 Exchange: ${cfg.exchange}` });
    agentMessage('log', { message: `💰 Starting Capital: $${cfg.startingCapital}` });
    agentMessage('log', { message: `⏱️  Trading Window: ${cfg.tradingWindow / 60000} minutes` });
    agentMessage('log', { message: `🔄 Check Interval: ${cfg.checkInterval / 60000} minutes` });
    
    // Fetch initial market data
    const pairs = await this.marketClient.getTradablePairs(cfg.minVolume24h);
    agentMessage('log', { message: `📊 Found ${pairs.length} tradable USDT pairs` });
    
    // Cache prices
    for (const pair of pairs) {
      this.prices[pair.symbol] = pair.price;
    }
    
    return pairs;
  }

  async analyzeAndTrade(pairs) {
    this.cycleCount++;
    const now = new Date().toISOString();
    agentMessage('log', { message: `
━━━ Cycle ${this.cycleCount} | ${now} ━━━` });

    const cfg = this.tunedConfig || config;

    const opportunities = [];

    const analysisConcurrency = 5;
    await asyncPool(analysisConcurrency, pairs, async (pair) => {
      try {
        const klines = await this.marketClient.getKlines(pair.symbol, cfg.candleInterval, cfg.backtestCandles);

        if (!Array.isArray(klines) || klines.length < 50) return;

        const ohlcv = klines.map(k => ({
          time: k[0],
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
        }));

        this.prices[pair.symbol] = ohlcv[ohlcv.length - 1].close;

        const signal = StrategyEngine.evaluateStrategies(ohlcv, pair, cfg.strategies, this.strategyWeights);
        if (signal.signal === 'HOLD') return;

        opportunities.push({
          symbol: pair.symbol,
          price: ohlcv[ohlcv.length - 1].close,
          signal: signal.signal,
          score: signal.score,
          strategy: signal.strategy,
          consensus: signal.consensus,
          change24h: pair.change24h,
        });
      } catch (e) {
        const key = `${pair.symbol}:${e && e.message ? e.message : 'unknown_error'}`;
        this.pairErrors[key] = (this.pairErrors[key] || 0) + 1;
        if (this.pairErrors[key] <= 3) {
          agentMessage('log', { message: `⚠️  ${pair.symbol}: ${e.message}` });
        }
      }
    });
    
    opportunities.sort((a, b) => (b.consensus * 10 + b.score) - (a.consensus * 10 + a.score));
    
    agentMessage('log', { message: `📈 Found ${opportunities.length} opportunities` });
    
    const signals = [];

    // Always check exit triggers for all open positions (stop-loss / take-profit)
    // so we don't miss exits when a symbol isn't in the top actionable slice.
    for (const symbol of Object.keys(this.paperEngine.positions)) {
      const currentPrice = this.prices[symbol];
      if (typeof currentPrice !== 'number') continue;

      const exitTrigger = this.paperEngine.checkExitTriggers(symbol, currentPrice);
      if (!exitTrigger) continue;

      agentMessage('log', { message: `🛑 ${symbol}: ${exitTrigger.reason}` });
      const result = this.paperEngine.sell(symbol, currentPrice, Date.now(), exitTrigger.type);
      if (!result.success) continue;

      const payload = {
        action: 'SELL',
        symbol,
        price: currentPrice,
        profitPercent: result.trade.profitPercent,
        profit: result.trade.profit,
        reason: exitTrigger.type,
        timestamp: result.trade.timestamp,
        cycle: this.cycleCount,
        heldMs: result.trade.heldMs,
        trade: result.trade,
        summary: this.paperEngine.getSummary(this.prices),
      };
      signals.push({
        action: 'SELL',
        symbol,
        price: currentPrice,
        profit: result.trade.profitPercent?.toFixed(2) || 0,
        reason: exitTrigger.type,
      });
      agentMessage('trade_alert', payload);
      TelegramReporter.sendTradeAlert(payload, payload.summary).catch(() => {});
      this.logger.logTrade(result.trade).catch(() => {});
    }

    const actionable = opportunities.filter(opp => {
      if (opp.signal === 'BUY') return !this.paperEngine.positions[opp.symbol];
      if (opp.signal === 'SELL') return Boolean(this.paperEngine.positions[opp.symbol]);
      return false;
    });

    for (const opp of actionable.slice(0, 3)) {
      const currentPrice = this.prices[opp.symbol];
      
      if (this.paperEngine.positions[opp.symbol]) {
        const exitTrigger = this.paperEngine.checkExitTriggers(opp.symbol, currentPrice);
        if (exitTrigger) {
          agentMessage('log', { message: `🛑 ${opp.symbol}: ${exitTrigger.reason}` });
          const result = this.paperEngine.sell(opp.symbol, currentPrice, Date.now(), exitTrigger.type);
          if (result.success) {
            const payload = {
              action: 'SELL',
              symbol: opp.symbol,
              price: currentPrice,
              profitPercent: result.trade.profitPercent,
              profit: result.trade.profit,
              reason: exitTrigger.type,
              timestamp: result.trade.timestamp,
              cycle: this.cycleCount,
              heldMs: result.trade.heldMs,
              trade: result.trade,
              summary: this.paperEngine.getSummary(this.prices),
            };
            signals.push({
              action: 'SELL',
              symbol: opp.symbol,
              price: currentPrice,
              profit: result.trade.profitPercent?.toFixed(2) || 0,
              reason: exitTrigger.type,
            });
            agentMessage('trade_alert', payload);
            TelegramReporter.sendTradeAlert(payload, payload.summary).catch(() => {});
            this.logger.logTrade(result.trade).catch(() => {});
          }
          continue;
        }
      }
      
      if (opp.signal === 'BUY' && !this.paperEngine.positions[opp.symbol]) {
        const result = this.paperEngine.buy(
          opp.symbol,
          currentPrice,
          Date.now(),
          Math.min(opp.score, 1),
          {
            entryStrategy: opp.strategy,
            entryConsensus: opp.consensus,
            entryScore: opp.score,
          }
        );
        if (result.success) {
          agentMessage('log', { message: `✅ BUY ${opp.symbol} @ $${currentPrice.toFixed(6)} | Strategy: ${opp.strategy} | Consensus: ${opp.consensus}` });
          const payload = {
            action: 'BUY',
            symbol: opp.symbol,
            price: currentPrice,
            strategy: opp.strategy,
            consensus: opp.consensus,
            score: opp.score,
            timestamp: result.trade.timestamp,
            cycle: this.cycleCount,
            trade: result.trade,
            position: result.position,
            summary: this.paperEngine.getSummary(this.prices),
          };
          signals.push({
            action: 'BUY',
            symbol: opp.symbol,
            price: currentPrice,
            strategy: opp.strategy,
            consensus: opp.consensus,
          });
          agentMessage('trade_alert', payload);
          TelegramReporter.sendTradeAlert(payload, payload.summary).catch(() => {});
          this.logger.logTrade(result.trade).catch(() => {});
        } else {
          if (result && result.error) {
            const size = typeof result.tradeSize === 'number' ? result.tradeSize : null;
            agentMessage('log', {
              message: `↩️  Skipped BUY ${opp.symbol}: ${result.error}${size !== null ? ` ($${size.toFixed(2)})` : ''}`,
            });
          }
        }
      } else if (opp.signal === 'SELL' && this.paperEngine.positions[opp.symbol]) {
        const result = this.paperEngine.sell(opp.symbol, currentPrice, Date.now(), 'STRATEGY');
        if (result.success) {
          agentMessage('log', { message: `💰 SELL ${opp.symbol} @ $${currentPrice.toFixed(6)} | P/L: ${result.trade.profitPercent?.toFixed(2)}%` });
          const payload = {
            action: 'SELL',
            symbol: opp.symbol,
            price: currentPrice,
            profitPercent: result.trade.profitPercent,
            profit: result.trade.profit,
            reason: 'STRATEGY',
            timestamp: result.trade.timestamp,
            cycle: this.cycleCount,
            heldMs: result.trade.heldMs,
            trade: result.trade,
            summary: this.paperEngine.getSummary(this.prices),
          };
          signals.push({
            action: 'SELL',
            symbol: opp.symbol,
            price: currentPrice,
            profit: result.trade.profitPercent?.toFixed(2) || 0,
            reason: 'STRATEGY',
          });
          agentMessage('trade_alert', payload);
          TelegramReporter.sendTradeAlert(payload, payload.summary).catch(() => {});
          this.logger.logTrade(result.trade).catch(() => {});
        }
      }
    }
    
    return signals;
  }

  async report() {
    const summary = this.paperEngine.getSummary(this.prices);
    
    agentMessage('log', { message: `
━━━ Portfolio Summary ━━━` });
    agentMessage('log', { message: `💵 Total Value: $${summary.totalValue.toFixed(2)}` });
    agentMessage('log', { message: `📈 Return: ${summary.returnPercent >= 0 ? '+' : ''}${summary.returnPercent.toFixed(2)}% ($${summary.totalReturn.toFixed(2)})` });
    agentMessage('log', { message: `💵 Cash: $${summary.cash.toFixed(2)}` });
    agentMessage('log', { message: `📊 Positions: ${summary.positionsValue.toFixed(2)}` });
    agentMessage('log', { message: `🔄 Trades: ${summary.tradesCount} (${summary.buys} buys, ${summary.sells} sells)` });
    agentMessage('log', { message: `🏆 Win Rate: ${summary.winRate.toFixed(1)}%` });
    agentMessage('log', { message: `⏱️  Remaining: ${Math.floor(summary.remainingTime / 60000)}m ${Math.floor((summary.remainingTime % 60000) / 1000)}s` });
    
    if (summary.openPositions.length > 0) {
      agentMessage('log', { message: `
Open Positions:` });
      for (const pos of summary.openPositions) {
        agentMessage('log', { message: `  ${pos.symbol}: ${pos.quantity.toFixed(6)} @ $${pos.avgPrice.toFixed(6)} | P/L: ${pos.unrealizedPercent >= 0 ? '+' : ''}${pos.unrealizedPercent.toFixed(2)}%` });
      }
    }
    
    return summary;
  }

  async run() {
    this.running = true;
    const startTime = Date.now();
    
    try {
      this.tunedConfig = await ParamTuner.loadAndApply(config);
      this.paperEngine = new PaperEngine(this.tunedConfig);

      this.strategyWeights = await StrategyOptimizer.loadStrategyWeights(config);

      await this.logger.startSession({
        exchange: this.tunedConfig.exchange,
        startingCapital: this.tunedConfig.startingCapital,
        tradingWindow: this.tunedConfig.tradingWindow,
        checkInterval: this.tunedConfig.checkInterval,
        candleInterval: this.tunedConfig.candleInterval,
        backtestCandles: this.tunedConfig.backtestCandles,
        minVolume24h: this.tunedConfig.minVolume24h,
        risk: {
          maxPositionSize: this.tunedConfig.maxPositionSize,
          stopLossPercent: this.tunedConfig.stopLossPercent,
          takeProfitPercent: this.tunedConfig.takeProfitPercent,
        },
        strategies: this.tunedConfig.strategies,
        strategyWeights: this.strategyWeights,
        tunedParams: ParamTuner.getTunedParamsSnapshot(this.tunedConfig),
      });

      // Initialize
      let pairs = await this.initialize();
      
      // Main trading loop
      while (this.running && !this.paperEngine.isComplete()) {
        // Analyze and trade
        await this.analyzeAndTrade(pairs);
        
        // Report status
        const summary = await this.report();
        agentMessage('cycle_update', {
          summary,
          recentTrades: summary.recentTrades,
          openPositions: summary.openPositions,
          cycle: this.cycleCount,
        });
        // Telegram: only notify on trade open/close (BUY/SELL), not on every cycle update.
        
        // Wait for next cycle
        const remaining = this.paperEngine.getRemainingTime();
        if (remaining > 0) {
          const cfg = this.tunedConfig || config;
          const waitTime = Math.min(cfg.checkInterval, remaining);
          agentMessage('log', { message: `
⏳ Waiting ${waitTime / 60000} minutes until next cycle...` });

          await new Promise(resolve => {
            this._sleepTimer = setTimeout(resolve, waitTime);
          });

          this._sleepTimer = null;

          if (!this.running) break;
          
          // Refresh market data
          const freshPairs = await this.marketClient.getTradablePairs(cfg.minVolume24h);
          pairs = freshPairs;
          for (const pair of freshPairs) {
            this.prices[pair.symbol] = pair.price;
          }
        }
      }
      
      // Final report
      agentMessage('log', { message: `\n\n🏆 TRADING COMPLETE 🏆` });
      const finalSummary = await this.report();
      agentMessage('final_summary', { summary: finalSummary });

      await this.logger.endSession(finalSummary);

      await ParamTuner.updateAfterSession(config, finalSummary).catch(() => {});
      
      return finalSummary;
      
    } catch (error) {
      agentMessage('error', { message: `❌ Error: ${error.message}` });
      await this.logger.endSession({ error: error.message }).catch(() => {});
      await ParamTuner.updateAfterSession(config, { error: error.message }).catch(() => {});
      throw error;
    }
  }

  stop() {
    this.running = false;
    agentMessage('log', { message: '🛑 Stopping trader...' });

    if (this._sleepTimer) {
      clearTimeout(this._sleepTimer);
      this._sleepTimer = null;
    }
  }
}

// Run if called directly
if (require.main === module) {
  const trader = new PaperTrader();
  
  // Handle graceful shutdown
  const shutdown = (signal) => {
    agentMessage('log', { message: `🛑 Received ${signal}. Gracefully stopping...` });
    trader.stop();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  
  trader.run()
    .then(summary => {
      agentMessage('log', { message: `
✅ Trading session complete!` });
      process.exit(0);
    })
    .catch(err => {
      agentMessage('error', { message: `Fatal error: ${err.message}` });
      process.exit(1);
    });
}

module.exports = PaperTrader;
