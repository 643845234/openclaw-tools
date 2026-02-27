const fs = require('fs');
const path = require('path');

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function readJsonIfExists(filePath) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  try {
    const raw = await fs.promises.readFile(resolved, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJson(filePath, data) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
  await fs.promises.writeFile(resolved, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function applyOverrides(cfg, overrides) {
  if (!overrides) return cfg;

  if (typeof overrides.rsiOversold === 'number') cfg.strategies.rsi.oversold = overrides.rsiOversold;
  if (typeof overrides.rsiOverbought === 'number') cfg.strategies.rsi.overbought = overrides.rsiOverbought;
  if (typeof overrides.stopLossPercent === 'number') cfg.stopLossPercent = overrides.stopLossPercent;
  if (typeof overrides.takeProfitPercent === 'number') cfg.takeProfitPercent = overrides.takeProfitPercent;

  // Keep RSI thresholds sane
  if (cfg.strategies && cfg.strategies.rsi) {
    const rsi = cfg.strategies.rsi;
    if (typeof rsi.oversold === 'number' && typeof rsi.overbought === 'number') {
      if (rsi.oversold >= rsi.overbought - 5) {
        rsi.oversold = Math.max(10, rsi.overbought - 10);
      }
    }
  }

  return cfg;
}

function getTunedParamsSnapshot(cfg) {
  return {
    rsiOversold: cfg?.strategies?.rsi?.oversold,
    rsiOverbought: cfg?.strategies?.rsi?.overbought,
    stopLossPercent: cfg?.stopLossPercent,
    takeProfitPercent: cfg?.takeProfitPercent,
  };
}

function proposeNextParams(current, cfg) {
  const step = cfg.tuning?.step || {};
  const bounds = cfg.tuning?.bounds || {};

  const next = { ...current };

  if (typeof current.rsiOversold === 'number') {
    const s = typeof step.rsiOversold === 'number' ? step.rsiOversold : 1;
    const dir = Math.random() < 0.5 ? -1 : 1;
    next.rsiOversold = current.rsiOversold + dir * s;
    if (bounds.rsiOversold) next.rsiOversold = clamp(next.rsiOversold, bounds.rsiOversold.min, bounds.rsiOversold.max);
  }

  if (typeof current.rsiOverbought === 'number') {
    const s = typeof step.rsiOverbought === 'number' ? step.rsiOverbought : 1;
    const dir = Math.random() < 0.5 ? -1 : 1;
    next.rsiOverbought = current.rsiOverbought + dir * s;
    if (bounds.rsiOverbought) next.rsiOverbought = clamp(next.rsiOverbought, bounds.rsiOverbought.min, bounds.rsiOverbought.max);
  }

  if (typeof current.stopLossPercent === 'number') {
    const s = typeof step.stopLossPercent === 'number' ? step.stopLossPercent : 0.0025;
    const dir = Math.random() < 0.5 ? -1 : 1;
    next.stopLossPercent = current.stopLossPercent + dir * s;
    if (bounds.stopLossPercent) next.stopLossPercent = clamp(next.stopLossPercent, bounds.stopLossPercent.min, bounds.stopLossPercent.max);
  }

  if (typeof current.takeProfitPercent === 'number') {
    const s = typeof step.takeProfitPercent === 'number' ? step.takeProfitPercent : 0.0025;
    const dir = Math.random() < 0.5 ? -1 : 1;
    next.takeProfitPercent = current.takeProfitPercent + dir * s;
    if (bounds.takeProfitPercent) next.takeProfitPercent = clamp(next.takeProfitPercent, bounds.takeProfitPercent.min, bounds.takeProfitPercent.max);
  }

  // Ensure RSI relation
  if (typeof next.rsiOversold === 'number' && typeof next.rsiOverbought === 'number') {
    if (next.rsiOversold >= next.rsiOverbought - 5) {
      next.rsiOversold = Math.max(10, next.rsiOverbought - 10);
    }
  }

  return next;
}

async function loadAndApply(config) {
  const cfg = deepClone(config);

  if (!cfg.tuning || !cfg.tuning.enabled) return cfg;

  const filePath = cfg.tuning.filePath || './paper_trader_tuning.json';
  const state = (await readJsonIfExists(filePath)) || {};

  const base = {
    rsiOversold: cfg?.strategies?.rsi?.oversold,
    rsiOverbought: cfg?.strategies?.rsi?.overbought,
    stopLossPercent: cfg?.stopLossPercent,
    takeProfitPercent: cfg?.takeProfitPercent,
  };

  const current = { ...base, ...(state.current || {}) };
  applyOverrides(cfg, current);

  return cfg;
}

async function updateAfterSession(config, finalSummary) {
  if (!config.tuning || !config.tuning.enabled) return;
  const filePath = config.tuning.filePath || './paper_trader_tuning.json';

  const state = (await readJsonIfExists(filePath)) || {};

  const score = finalSummary && typeof finalSummary.returnPercent === 'number' ? finalSummary.returnPercent : null;

  // Initialize state if missing
  if (!state.current) {
    state.current = {
      rsiOversold: config?.strategies?.rsi?.oversold,
      rsiOverbought: config?.strategies?.rsi?.overbought,
      stopLossPercent: config?.stopLossPercent,
      takeProfitPercent: config?.takeProfitPercent,
    };
  }

  if (!state.best) state.best = { ...state.current };
  if (typeof state.bestScore !== 'number') state.bestScore = Number.NEGATIVE_INFINITY;

  if (typeof score === 'number') {
    state.lastScore = score;

    if (score > state.bestScore) {
      state.bestScore = score;
      state.best = { ...state.current };
    }

    // Simple explore/exploit:
    // - If we improved, keep current and explore around it
    // - If not, revert to best and explore around best
    const seed = score >= state.bestScore ? state.current : state.best;
    state.current = proposeNextParams(seed, config);
  } else {
    // If session failed, do not change params
    state.lastScore = null;
  }

  state.updatedAt = Date.now();
  await writeJson(filePath, state);
}

module.exports = {
  loadAndApply,
  updateAfterSession,
  getTunedParamsSnapshot,
};
