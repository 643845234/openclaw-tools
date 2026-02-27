const SessionLogger = require('./session-logger');

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function computeStrategyStats(records) {
  const stats = {};
  const positions = {}; // sessionId:symbol -> entry meta

  for (const rec of records) {
    if (!rec || rec.event !== 'trade' || !rec.trade) continue;
    const t = rec.trade;
    const key = `${rec.sessionId}:${t.symbol}`;

    if (t.positionAction === 'OPEN') {
      positions[key] = {
        entryStrategy: t.entryStrategy || t.strategy || null,
        entryConsensus: t.entryConsensus ?? null,
        entryScore: t.entryScore ?? null,
      };
      continue;
    }

    if (t.positionAction === 'CLOSE') {
      const entry = positions[key];
      const strat = (t.entryStrategy || (entry && entry.entryStrategy) || 'Unknown');
      if (!stats[strat]) {
        stats[strat] = { trades: 0, wins: 0, totalProfit: 0, totalProfitPercent: 0 };
      }

      stats[strat].trades += 1;
      const profit = typeof t.profit === 'number' ? t.profit : 0;
      const pct = typeof t.profitPercent === 'number' ? t.profitPercent : 0;
      stats[strat].totalProfit += profit;
      stats[strat].totalProfitPercent += pct;
      if (profit > 0) stats[strat].wins += 1;

      delete positions[key];
    }
  }

  return stats;
}

function statsToWeights(stats, opts) {
  const weights = {};
  const minTrades = opts.minTradesPerStrategy || 5;
  const maxW = opts.maxWeight || 1.5;
  const minW = opts.minWeight || 0.5;

  for (const [name, s] of Object.entries(stats)) {
    if (!s.trades || s.trades < minTrades) continue;

    const winRate = s.wins / s.trades; // 0..1
    const avgPct = s.totalProfitPercent / s.trades; // percent

    // Very simple heuristic:
    // - Base on win rate around 50%
    // - Nudge slightly by avg % return
    const winComponent = 1 + (winRate - 0.5); // 0.5->1.0, 1.0->1.5, 0.0->0.5
    const pctComponent = 1 + clamp(avgPct / 20, -0.25, 0.25); // +/-25% impact at +/-5%

    weights[name] = clamp(winComponent * pctComponent, minW, maxW);
  }

  return weights;
}

async function loadStrategyWeights(config) {
  if (!config || !config.logging || !config.logging.filePath) return {};
  if (!config.optimizer || !config.optimizer.enabled) return {};

  const records = await SessionLogger.readAll(config.logging.filePath);
  const stats = computeStrategyStats(records);
  return statsToWeights(stats, config.optimizer);
}

module.exports = {
  loadStrategyWeights,
  computeStrategyStats,
  statsToWeights,
};
