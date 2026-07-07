export const ALLOWED_TIMEFRAMES = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"];

/**
 * @typedef {Object} StrategySpec
 * @property {string} id
 * @property {string} name
 * @property {string} market
 * @property {string} symbol
 * @property {string} timeframe
 * @property {string} thesis
 * @property {string} regimeHypothesis
 * @property {Array<Rule>} entryRules
 * @property {Array<Rule>} exitRules
 * @property {RiskRule} stopLoss
 * @property {RiskRule} takeProfit
 * @property {number} riskPerTrade
 * @property {number} maxDailyLoss
 * @property {number} maxDrawdown
 * @property {FeeModel} fees
 * @property {SlippageModel} slippage
 * @property {Array<FilterRule>} filters
 * @property {Array<string>} indicatorsUsed
 * @property {Array<string>} requiredDataSources
 * @property {string} createdAt
 * @property {"draft"|"tested"|"passed"|"failed"|"archived"} status
 * @property {ExecutionPolicy} execution
 */

/**
 * @typedef {Object} Rule
 * @property {string} id
 * @property {string} type
 * @property {string} description
 * @property {Record<string, number|string|boolean>} params
 */

/**
 * @typedef {Object} FilterRule
 * @property {string} type
 * @property {boolean} enabled
 * @property {string} description
 * @property {Record<string, number|string|boolean>} params
 */

/**
 * @typedef {Object} RiskRule
 * @property {"atr"|"percent"|"rr"} type
 * @property {number} value
 */

/**
 * @typedef {Object} FeeModel
 * @property {number} makerBps
 * @property {number} takerBps
 */

/**
 * @typedef {Object} SlippageModel
 * @property {"bps"|"ticks"} type
 * @property {number} value
 */

/**
 * @typedef {Object} ExecutionPolicy
 * @property {boolean} enabled
 * @property {string} status
 * @property {Array<string>} requirements
 */

export function createBaseStrategySpec(overrides = {}) {
  return {
    id: `strategy-${Date.now()}`,
    name: "Compression Breakout Research Draft",
    market: "perp",
    symbol: "BTC",
    timeframe: "5m",
    thesis: "Research whether volatility compression followed by expansion can capture directional continuation without exceeding prop-style loss limits.",
    regimeHypothesis: "Best suited for liquid trending or post-compression expansion regimes; expected to underperform in noisy mean-reverting chop.",
    entryRules: [
      {
        id: "compression-breakout",
        type: "breakout_after_compression",
        description: "Enter long when price closes above the recent compression range high.",
        params: { lookback: 24, compressionAtrPercentile: 35 },
      },
      {
        id: "volatility-expansion",
        type: "atr_expansion",
        description: "Require current ATR to expand above its short moving average.",
        params: { atrPeriod: 14, expansionMultiple: 1.08 },
      },
    ],
    exitRules: [
      {
        id: "risk-multiple-target",
        type: "take_profit_or_stop",
        description: "Exit on stop loss, profit target, or max bars in trade.",
        params: { maxBarsInTrade: 36 },
      },
    ],
    stopLoss: { type: "atr", value: 1.6 },
    takeProfit: { type: "rr", value: 2.2 },
    riskPerTrade: 0.005,
    maxDailyLoss: 0.05,
    maxDrawdown: 0.1,
    fees: { makerBps: 2, takerBps: 5 },
    slippage: { type: "bps", value: 2 },
    filters: [
      {
        type: "ema_trend",
        enabled: true,
        description: "Only take longs when close is above EMA.",
        params: { emaPeriod: 200 },
      },
      {
        type: "session",
        enabled: true,
        description: "Avoid low-liquidity handoff periods.",
        params: { startHourUtc: 7, endHourUtc: 21 },
      },
      {
        type: "funding_rate",
        enabled: false,
        description: "Optional funding filter for later Hyperliquid integration.",
        params: { maxFundingBps: 4 },
      },
      {
        type: "relative_strength",
        enabled: false,
        description: "Optional BTC/ETH/SOL relative strength filter.",
        params: { lookback: 48 },
      },
    ],
    indicatorsUsed: ["ATR", "EMA", "range compression", "session filter"],
    requiredDataSources: ["ohlcv"],
    createdAt: new Date().toISOString(),
    status: "draft",
    execution: {
      enabled: false,
      status: "Execution disabled",
      requirements: [
        "paper trading first",
        "exchange API key setup",
        "explicit user confirmation",
        "max loss guard",
        "kill switch",
        "no hidden autonomous trading",
      ],
    },
    ...overrides,
  };
}

export function validateStrategySpec(spec) {
  const errors = [];
  const warnings = [];

  if (!spec || typeof spec !== "object") {
    return { valid: false, errors: ["Strategy spec must be an object."], warnings };
  }

  requireString(spec, "name", errors);
  requireString(spec, "market", errors);
  requireString(spec, "symbol", errors);
  requireString(spec, "timeframe", errors);
  requireString(spec, "thesis", errors);
  requireString(spec, "regimeHypothesis", errors);

  if (spec.timeframe && !ALLOWED_TIMEFRAMES.includes(spec.timeframe)) {
    warnings.push(`Timeframe ${spec.timeframe} is not in the preferred MVP set.`);
  }

  requireArray(spec, "entryRules", errors);
  requireArray(spec, "exitRules", errors);
  requireArray(spec, "filters", errors);
  requireArray(spec, "indicatorsUsed", errors);
  requireArray(spec, "requiredDataSources", errors);

  requireNumber(spec, "riskPerTrade", errors);
  requireNumber(spec, "maxDailyLoss", errors);
  requireNumber(spec, "maxDrawdown", errors);

  if (spec.riskPerTrade > 0.02) warnings.push("Risk per trade is above 2%; review before testing prop rules.");
  if (spec.execution?.enabled) errors.push("Real-money execution must remain disabled in this MVP.");

  if (!spec.requiredDataSources?.includes("ohlcv")) {
    errors.push("MVP backtests require OHLCV data.");
  }

  if (!["draft", "tested", "passed", "failed", "archived"].includes(spec.status)) {
    errors.push("status must be draft, tested, passed, failed, or archived.");
  }

  return { valid: errors.length === 0, errors, warnings };
}

function requireString(obj, key, errors) {
  if (typeof obj[key] !== "string" || !obj[key].trim()) errors.push(`${key} is required.`);
}

function requireNumber(obj, key, errors) {
  if (typeof obj[key] !== "number" || Number.isNaN(obj[key])) errors.push(`${key} must be a number.`);
}

function requireArray(obj, key, errors) {
  if (!Array.isArray(obj[key])) errors.push(`${key} must be an array.`);
}
