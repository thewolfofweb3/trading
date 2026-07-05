export function generateMockCandles({ symbol = "BTC", timeframe = "5m", count = 600, seed = 42 } = {}) {
  const random = seeded(seed);
  const intervalMs = timeframeToMs(timeframe);
  const start = Date.now() - count * intervalMs;
  let close = symbol === "SOL" ? 145 : symbol === "ETH" ? 3400 : 64000;
  let compression = false;

  return Array.from({ length: count }, (_, index) => {
    if (index % 130 === 0) compression = true;
    if (index % 130 === 35) compression = false;

    const drift = Math.sin(index / 31) * 0.0009 + (index > count * 0.45 ? 0.00035 : -0.00008);
    const vol = compression ? 0.0014 : 0.0045 + Math.abs(Math.sin(index / 17)) * 0.002;
    const move = close * (drift + (random() - 0.5) * vol);
    const open = close;
    close = Math.max(1, close + move);
    const spread = close * (vol * (0.7 + random()));
    const high = Math.max(open, close) + spread;
    const low = Math.min(open, close) - spread;
    const volume = Math.round((compression ? 180 : 520) * (1 + random() * 2));

    return {
      time: start + index * intervalMs,
      open,
      high,
      low,
      close,
      volume,
      source: "mock",
    };
  });
}

export function timeframeToMs(timeframe) {
  const value = Number.parseInt(timeframe, 10);
  if (timeframe.endsWith("m")) return value * 60_000;
  if (timeframe.endsWith("h")) return value * 60 * 60_000;
  if (timeframe.endsWith("d")) return value * 24 * 60 * 60_000;
  return 5 * 60_000;
}

function seeded(seed) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}
