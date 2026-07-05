import { createBaseStrategySpec, validateStrategySpec } from "../strategy/schema.js";

export async function generateStrategySpecFromPrompt(prompt) {
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error("Prompt is required.");

  try {
    const response = await fetch("/api/strategy/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: trimmed }),
    });

    if (response.ok) {
      const payload = await response.json();
      const spec = normalizeSpec(payload.strategySpec, trimmed);
      const validation = validateStrategySpec(spec);
      return { spec, validation, source: payload.source ?? "openrouter" };
    }
  } catch (error) {
    console.info("OpenRouter strategy generation unavailable, using local rule generator.", error);
  }

  const spec = localStrategyFromPrompt(trimmed);
  return { spec, validation: validateStrategySpec(spec), source: "local-rule-generator" };
}

export function localStrategyFromPrompt(prompt) {
  const upper = prompt.toUpperCase();
  const symbol = upper.includes("SOL") ? "SOL" : upper.includes("ETH") ? "ETH" : "BTC";
  const timeframe = upper.match(/\b(1M|3M|5M|15M|30M|1H|4H|1D)\b/)?.[1]?.toLowerCase() ?? "5m";
  const propChallenge = /prop|funded|challenge/i.test(prompt);

  return createBaseStrategySpec({
    id: `draft-${Date.now()}`,
    name: `${symbol} ${timeframe} Compression Breakout Draft`,
    symbol,
    timeframe,
    maxDailyLoss: propChallenge ? 0.05 : 0.08,
    maxDrawdown: propChallenge ? 0.1 : 0.15,
    requiredDataSources: ["ohlcv", "hyperliquid_candles"],
  });
}

function normalizeSpec(spec, prompt) {
  return createBaseStrategySpec({
    ...spec,
    id: spec?.id ?? `draft-${Date.now()}`,
    name: spec?.name ?? "AI Strategy Draft",
    requiredDataSources: spec?.requiredDataSources?.length ? spec.requiredDataSources : ["ohlcv", "hyperliquid_candles"],
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
      ...(spec?.execution ?? {}),
      enabled: false,
    },
    sourcePrompt: prompt,
  });
}
