import { validateStrategySpec } from "../strategy/schema.js";

export function runBacktest({ candles, strategySpec, startingEquity = 100000, requirements = {} }) {
  const validation = validateStrategySpec(strategySpec);
  const warnings = [...validation.warnings];
  const errors = [...validation.errors];

  if (!validation.valid) {
    return emptyResult({ startingEquity, warnings, errors });
  }

  if (!Array.isArray(candles) || candles.length < 80) {
    errors.push("Backtest requires at least 80 OHLCV candles.");
    return emptyResult({ startingEquity, warnings, errors });
  }

  const atr = computeAtr(candles, 14);
  const ema = computeEma(candles.map((candle) => candle.close), getFilterParam(strategySpec, "ema_trend", "emaPeriod", 200));
  const lookback = getRuleParam(strategySpec, "breakout_after_compression", "lookback", 24);
  const stopAtr = strategySpec.stopLoss?.value ?? 1.6;
  const targetR = strategySpec.takeProfit?.value ?? 2.2;
  const maxBars = getRuleParam(strategySpec, "take_profit_or_stop", "maxBarsInTrade", 36);
  const feeBps = strategySpec.fees?.takerBps ?? 5;
  const slippageBps = strategySpec.slippage?.value ?? 2;
  const session = getFilter(strategySpec, "session");

  let equity = startingEquity;
  let peakEquity = startingEquity;
  let maxDrawdown = 0;
  let dailyStartEquity = startingEquity;
  let dailyLossBreached = false;
  let currentDay = dayKey(candles[0].time);
  let position = null;
  const trades = [];
  const equityCurve = [{ time: candles[0].time, equity }];

  for (let index = Math.max(lookback + 20, 60); index < candles.length; index += 1) {
    const candle = candles[index];

    if (dayKey(candle.time) !== currentDay) {
      currentDay = dayKey(candle.time);
      dailyStartEquity = equity;
    }

    if (position) {
      const exit = evaluateExit({ position, candle, index, maxBars });
      if (exit) {
        const result = closePosition({ position, candle, exit, feeBps, slippageBps, equity });
        equity = result.equity;
        trades.push(result.trade);
        position = null;
        equityCurve.push({ time: candle.time, equity });
      }
    }

    if (!position && passesEntry({ candles, atr, ema, index, lookback, session })) {
      const entryPrice = applySlippage(candle.close, slippageBps, "buy");
      const stopDistance = Math.max(atr[index] * stopAtr, entryPrice * 0.0025);
      const riskCapital = equity * strategySpec.riskPerTrade;
      const quantity = riskCapital / stopDistance;

      position = {
        entryIndex: index,
        entryTime: candle.time,
        entryPrice,
        stopPrice: entryPrice - stopDistance,
        targetPrice: entryPrice + stopDistance * targetR,
        quantity,
        riskCapital,
      };
    }

    peakEquity = Math.max(peakEquity, equity);
    maxDrawdown = Math.max(maxDrawdown, (peakEquity - equity) / peakEquity);
    if ((dailyStartEquity - equity) / dailyStartEquity > strategySpec.maxDailyLoss) dailyLossBreached = true;
  }

  if (position) {
    const last = candles[candles.length - 1];
    const result = closePosition({
      position,
      candle: last,
      exit: { reason: "end_of_test", price: last.close },
      feeBps,
      slippageBps,
      equity,
    });
    equity = result.equity;
    trades.push(result.trade);
    equityCurve.push({ time: last.time, equity });
  }

  const metrics = computeMetrics({
    trades,
    equity,
    startingEquity,
    maxDrawdown,
    feeBps,
    slippageBps,
    maxDailyLossBreached: dailyLossBreached,
    maxDrawdownLimit: strategySpec.maxDrawdown,
    requirements,
  });

  return {
    trades,
    equityCurve,
    metrics,
    warnings: ["Using mock OHLCV data. Results are for infrastructure testing only.", ...warnings],
    errors,
    dataMode: candles[0]?.source === "hyperliquid" ? "hyperliquid" : "mock",
  };
}

function emptyResult({ startingEquity, warnings, errors }) {
  return {
    trades: [],
    equityCurve: [{ time: Date.now(), equity: startingEquity }],
    metrics: computeMetrics({
      trades: [],
      equity: startingEquity,
      startingEquity,
      maxDrawdown: 0,
      feeBps: 0,
      slippageBps: 0,
      maxDailyLossBreached: false,
      maxDrawdownLimit: 0,
      requirements: {},
    }),
    warnings,
    errors,
    dataMode: "mock",
  };
}

function passesEntry({ candles, atr, ema, index, lookback, session }) {
  const candle = candles[index];
  const previous = candles.slice(index - lookback, index);
  const rangeHigh = Math.max(...previous.map((bar) => bar.high));
  const recentRanges = previous.map((bar) => bar.high - bar.low);
  const avgRange = average(recentRanges);
  const priorRanges = candles.slice(index - lookback * 2, index - lookback).map((bar) => bar.high - bar.low);
  const priorAvgRange = average(priorRanges);
  const compression = avgRange < priorAvgRange * 0.78;
  const breakout = candle.close > rangeHigh;
  const atrExpansion = atr[index] > average(atr.slice(index - 12, index)) * 1.04;
  const trendOk = !ema[index] || candle.close > ema[index];
  const sessionOk = !session?.enabled || withinSession(candle.time, session.params.startHourUtc, session.params.endHourUtc);

  return compression && breakout && atrExpansion && trendOk && sessionOk;
}

function evaluateExit({ position, candle, index, maxBars }) {
  if (candle.low <= position.stopPrice) return { reason: "stop_loss", price: position.stopPrice };
  if (candle.high >= position.targetPrice) return { reason: "take_profit", price: position.targetPrice };
  if (index - position.entryIndex >= maxBars) return { reason: "time_exit", price: candle.close };
  return null;
}

function closePosition({ position, candle, exit, feeBps, slippageBps, equity }) {
  const exitPrice = applySlippage(exit.price, slippageBps, "sell");
  const gross = (exitPrice - position.entryPrice) * position.quantity;
  const notional = (position.entryPrice + exitPrice) * position.quantity;
  const fees = notional * (feeBps / 10000);
  const pnl = gross - fees;
  const nextEquity = equity + pnl;
  const rMultiple = pnl / position.riskCapital;

  return {
    equity: nextEquity,
    trade: {
      entryTime: position.entryTime,
      exitTime: candle.time,
      entryPrice: position.entryPrice,
      exitPrice,
      quantity: position.quantity,
      pnl,
      fees,
      rMultiple,
      reason: exit.reason,
    },
  };
}

function computeMetrics({ trades, equity, startingEquity, maxDrawdown, feeBps, slippageBps, maxDailyLossBreached, maxDrawdownLimit, requirements }) {
  const wins = trades.filter((trade) => trade.pnl > 0);
  const losses = trades.filter((trade) => trade.pnl < 0);
  const grossProfit = sum(wins.map((trade) => trade.pnl));
  const grossLoss = Math.abs(sum(losses.map((trade) => trade.pnl)));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss;
  const netPnl = equity - startingEquity;
  const averageWin = wins.length ? average(wins.map((trade) => trade.pnl)) : 0;
  const averageLoss = losses.length ? Math.abs(average(losses.map((trade) => trade.pnl))) : 0;
  const winRate = trades.length ? wins.length / trades.length : 0;
  const lossRate = trades.length ? losses.length / trades.length : 0;
  const expectancy = trades.length ? average(trades.map((trade) => trade.pnl)) : 0;
  const longestLosingStreak = computeLongestLosingStreak(trades);
  const requirementChecks = {
    minWinRate: requirements.minWinRate == null || winRate >= requirements.minWinRate,
    maxDrawdown: requirements.maxDrawdown == null || maxDrawdown <= requirements.maxDrawdown,
    minProfitFactor: requirements.minProfitFactor == null || profitFactor >= requirements.minProfitFactor,
    minRiskReward: requirements.minRiskReward == null || (averageLoss ? averageWin / averageLoss : Infinity) >= requirements.minRiskReward,
  };
  const pass = !maxDailyLossBreached && maxDrawdown <= maxDrawdownLimit && trades.length >= 1 && Object.values(requirementChecks).every(Boolean);

  return {
    netPnl,
    winRate,
    lossRate,
    averageWin,
    averageLoss,
    riskReward: averageLoss ? averageWin / averageLoss : Infinity,
    maxDrawdown,
    profitFactor,
    averageR: trades.length ? average(trades.map((trade) => trade.rMultiple)) : 0,
    fees: sum(trades.map((trade) => trade.fees)),
    slippageBps,
    feeBps,
    tradeCount: trades.length,
    expectancy,
    longestLosingStreak,
    requirementChecks,
    propRules: {
      pass,
      maxDailyLossBreached,
      maxDrawdownBreached: maxDrawdown > maxDrawdownLimit,
    },
  };
}

function computeLongestLosingStreak(trades) {
  let longest = 0;
  let current = 0;
  for (const trade of trades) {
    if (trade.pnl < 0) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function computeAtr(candles, period) {
  const trueRanges = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const prevClose = candles[index - 1].close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - prevClose), Math.abs(candle.low - prevClose));
  });
  return trueRanges.map((_, index) => average(trueRanges.slice(Math.max(0, index - period + 1), index + 1)));
}

function computeEma(values, period) {
  const alpha = 2 / (period + 1);
  const ema = [];
  values.forEach((value, index) => {
    ema[index] = index === 0 ? value : value * alpha + ema[index - 1] * (1 - alpha);
  });
  return ema;
}

function applySlippage(price, bps, side) {
  const direction = side === "buy" ? 1 : -1;
  return price * (1 + direction * (bps / 10000));
}

function getRuleParam(spec, type, param, fallback) {
  const rule = [...(spec.entryRules ?? []), ...(spec.exitRules ?? [])].find((item) => item.type === type);
  return Number(rule?.params?.[param] ?? fallback);
}

function getFilterParam(spec, type, param, fallback) {
  return Number(getFilter(spec, type)?.params?.[param] ?? fallback);
}

function getFilter(spec, type) {
  return (spec.filters ?? []).find((filter) => filter.type === type);
}

function withinSession(time, startHour, endHour) {
  const hour = new Date(time).getUTCHours();
  return startHour <= endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
}

function dayKey(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function average(values) {
  return values.length ? sum(values) / values.length : 0;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}
