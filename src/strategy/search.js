import { runBacktest } from "../backtest/engine.js";
import { createBaseStrategySpec } from "./schema.js";

const STRATEGY_FAMILIES = [
  "breakout_after_compression",
  "trend_continuation",
  "ema_vwap_filter",
  "volatility_expansion",
  "atr_stop_system",
  "liquidity_sweep_reclaim",
  "session_momentum",
  "range_breakout",
  "mean_reversion_overextension",
  "funding_aware_filter",
  "relative_strength",
  "volume_candle_trend",
];

export function parseRequirements(prompt = {}) {
  if (typeof prompt === "object" && prompt !== null && !Array.isArray(prompt)) {
    return normalizeRequirements(prompt);
  }

  const text = String(prompt);
  const upper = text.toUpperCase();
  const symbol = upper.match(/\b(BTC|ETH|SOL|HYPE|DOGE|XRP|BNB)\b/)?.[1] ?? "BTC";
  const timeframe = upper.match(/\b(1M|3M|5M|15M|30M|1H|4H|1D)\b/)?.[1]?.toLowerCase() ?? "5m";
  const win = text.match(/(\d+(?:\.\d+)?)\s*%?\s*win/i)?.[1];
  const dd = text.match(/drawdown\s*(?:under|below|<|less than)?\s*(\d+(?:\.\d+)?)\s*%/i)?.[1];
  const pf = text.match(/profit factor\s*(?:above|over|>|at least)?\s*(\d+(?:\.\d+)?)/i)?.[1];

  return normalizeRequirements({
    symbol,
    timeframe,
    minWinRate: win ? Number(win) / 100 : 0.55,
    maxDrawdown: dd ? Number(dd) / 100 : 0.08,
    minProfitFactor: pf ? Number(pf) : 1.2,
    attemptLimit: 12,
  });
}

export function searchStrategies({ candles, requirements, basePrompt = "" }) {
  const req = normalizeRequirements(requirements);
  const candidates = [];

  for (let attempt = 0; attempt < req.attemptLimit; attempt += 1) {
    const family = STRATEGY_FAMILIES[attempt % STRATEGY_FAMILIES.length];
    const spec = candidateSpec({ family, attempt, requirements: req, basePrompt });
    const backtest = runBacktest({ candles, strategySpec: spec, requirements: req });
    spec.status = backtest.metrics.propRules.pass ? "passed" : "failed";
    candidates.push({ spec, backtest, rankScore: scoreBacktest(backtest, req) });

    if (backtest.metrics.propRules.pass) break;
  }

  candidates.sort((a, b) => b.rankScore - a.rankScore);
  return {
    requirements: req,
    candidates,
    passed: candidates.find((candidate) => candidate.spec.status === "passed") ?? null,
    best: candidates[0] ?? null,
  };
}

export function candidateSpec({ family, attempt, requirements, basePrompt }) {
  const risk = Math.max(0.0025, 0.006 - attempt * 0.00025);
  const targetR = 1.5 + (attempt % 5) * 0.35;
  const lookback = 18 + (attempt % 6) * 4;

  return createBaseStrategySpec({
    id: `candidate-${Date.now()}-${attempt}`,
    name: `${requirements.symbol} ${requirements.timeframe} ${labelFamily(family)} ${attempt + 1}`,
    symbol: requirements.symbol,
    timeframe: requirements.timeframe,
    thesis: `Candidate generated from request: ${basePrompt || "strategy search"}.`,
    regimeHypothesis: regimeForFamily(family),
    entryRules: [
      {
        id: `${family}-entry`,
        type: family,
        description: entryDescription(family),
        params: { lookback, compressionAtrPercentile: 30 + attempt * 3, expansionMultiple: 1.02 + attempt * 0.01 },
      },
    ],
    exitRules: [
      {
        id: "risk-multiple-target",
        type: "take_profit_or_stop",
        description: "Exit on stop, target, or max bars.",
        params: { maxBarsInTrade: 24 + (attempt % 4) * 8 },
      },
    ],
    stopLoss: { type: "atr", value: 1.2 + (attempt % 4) * 0.25 },
    takeProfit: { type: "rr", value: targetR },
    riskPerTrade: risk,
    maxDailyLoss: 0.05,
    maxDrawdown: requirements.maxDrawdown,
    indicatorsUsed: indicatorsForFamily(family),
    requiredDataSources: ["ohlcv", "hyperliquid_candles"],
    status: "draft",
  });
}

function normalizeRequirements(requirements) {
  return {
    symbol: String(requirements.symbol ?? "BTC").toUpperCase(),
    timeframe: String(requirements.timeframe ?? "5m"),
    minWinRate: Number(requirements.minWinRate ?? 0.55),
    maxDrawdown: Number(requirements.maxDrawdown ?? 0.08),
    minProfitFactor: Number(requirements.minProfitFactor ?? 1.2),
    minRiskReward: requirements.minRiskReward == null ? null : Number(requirements.minRiskReward),
    attemptLimit: Math.min(Number(requirements.attemptLimit ?? 12), 24),
  };
}

function scoreBacktest(backtest, requirements) {
  const metrics = backtest.metrics;
  const pf = Number.isFinite(metrics.profitFactor) ? metrics.profitFactor : 4;
  return (
    metrics.winRate * 100 +
    pf * 15 +
    metrics.averageR * 10 -
    metrics.maxDrawdown * 120 -
    Math.max(0, requirements.minWinRate - metrics.winRate) * 80
  );
}

function labelFamily(family) {
  return family.replaceAll("_", " ");
}

function regimeForFamily(family) {
  if (family.includes("mean_reversion")) return "Overextended intraday moves with reversion toward a short-term fair value.";
  if (family.includes("trend")) return "Directional continuation during liquid momentum regimes.";
  if (family.includes("funding")) return "Directional setups filtered by extreme or unfavorable funding.";
  return "Compression or range expansion in liquid perpetual markets.";
}

function entryDescription(family) {
  const map = {
    breakout_after_compression: "Enter after tight range compression resolves with a closing breakout.",
    trend_continuation: "Enter with trend continuation when price holds above trend filter.",
    ema_vwap_filter: "Enter only when price confirms above EMA/VWAP-style regime filter.",
    volatility_expansion: "Enter when ATR expands after a low-volatility window.",
    atr_stop_system: "Enter breakout setups with ATR-defined invalidation.",
    liquidity_sweep_reclaim: "Enter after sweep below range low and reclaim of prior support.",
    session_momentum: "Enter only during configured liquid market session momentum.",
    range_breakout: "Enter on confirmed break of multi-bar range.",
    mean_reversion_overextension: "Fade overextension back toward trend mean.",
    funding_aware_filter: "Use funding as an optional filter when available.",
    relative_strength: "Prefer symbols showing relative strength versus peers.",
    volume_candle_trend: "Require trend candle and volume confirmation.",
  };
  return map[family] ?? "Enter on deterministic price-action condition.";
}

function indicatorsForFamily(family) {
  const base = ["ATR", "EMA", "range"];
  if (family.includes("vwap")) base.push("VWAP");
  if (family.includes("volume")) base.push("volume");
  if (family.includes("funding")) base.push("funding rate");
  if (family.includes("relative")) base.push("relative strength");
  return base;
}
