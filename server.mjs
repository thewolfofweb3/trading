import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createBaseStrategySpec } from "./src/strategy/schema.js";
import { generateMockCandles } from "./src/data/mock-candles.js";
import { HyperliquidDataAdapter } from "./src/data/hyperliquid-adapter.js";
import { runBacktest } from "./src/backtest/engine.js";
import { parseRequirements, searchStrategies } from "./src/strategy/search.js";

const port = Number(process.env.PORT ?? 8000);
const root = process.cwd();
loadEnv();
const hyperliquid = new HyperliquidDataAdapter({ apiUrl: process.env.HYPERLIQUID_API_URL ?? "https://api.hyperliquid.xyz" });

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/chat") return sendJson(response, await agentRoute(await readJson(request)));
    if (request.method === "POST" && request.url === "/api/agent") return sendJson(response, await agentRoute(await readJson(request)));
    if (request.method === "POST" && request.url === "/api/strategy/generate") return sendJson(response, await strategyGenerateRoute(await readJson(request)));
    if (request.method === "POST" && request.url === "/api/strategy/search") return sendJson(response, await strategySearchRoute(await readJson(request)));
    if (request.method === "POST" && request.url === "/api/backtest/run") return sendJson(response, await backtestRoute(await readJson(request)));
    if (request.method === "GET" && request.url === "/api/hyperliquid/markets") return sendJson(response, await hyperliquidMarketsRoute());
    if (request.method === "POST" && request.url === "/api/hyperliquid/candles") return sendJson(response, await hyperliquidCandlesRoute(await readJson(request)));

    await serveStatic(request, response);
  } catch (error) {
    sendJson(response, { ok: false, error: error.message }, 500);
  }
}).listen(port, () => {
  console.log(`Crypto research lab running on http://localhost:${port}`);
});

async function agentRoute({ message, state }) {
  const lower = String(message ?? "").toLowerCase();
  if (/what can you do|help|capabilities/.test(lower)) {
    return {
      ok: true,
      type: "capabilities",
      message:
        "I can generate structured crypto strategy specs, search deterministic strategy candidates, run mock or Hyperliquid-candle backtests, compare saved candidates, archive strategies, and explain results. Live execution is disabled.",
      stateSummary: summarizeState(state),
    };
  }

  const aiMessage = await chatWithOpenRouter({ message, state });
  if (aiMessage) {
    return { ok: true, type: "chat", message: aiMessage, stateSummary: summarizeState(state) };
  }

  return {
    ok: true,
    type: "route",
    message: "Use strategy generation/search/backtest actions for this request. Normal chat uses the cheaper OpenRouter chat model when configured.",
    stateSummary: summarizeState(state),
  };
}

async function strategyGenerateRoute({ prompt }) {
  const strategySpec = await generateWithOpenRouter({ prompt, modelEnv: "OPENROUTER_STRATEGY_MODEL", purpose: "strategy" });
  return { ok: true, strategySpec, source: process.env.OPENROUTER_API_KEY ? "openrouter" : "local-server-fallback" };
}

async function strategySearchRoute({ prompt, requirements }) {
  const parsed = parseRequirements(requirements ?? prompt);
  let candles;
  let dataMode = "hyperliquid";
  let dataError = null;

  try {
    candles = await getHyperliquidCandlesForSearch(parsed);
  } catch (error) {
    dataMode = "mock";
    dataError = error.message;
    candles = generateMockCandles({ symbol: parsed.symbol, timeframe: parsed.timeframe, count: 720, seed: 9001 });
  }

  const search = searchStrategies({ candles, requirements: parsed, basePrompt: prompt });
  return { ok: true, dataMode, dataError, ...search };
}

async function backtestRoute({ strategySpec, requirements, useHyperliquid = false }) {
  let candles;
  let dataMode = "mock";
  let dataError = null;

  if (useHyperliquid) {
    try {
      candles = await getHyperliquidCandlesForSearch({ symbol: strategySpec.symbol, timeframe: strategySpec.timeframe });
      dataMode = "hyperliquid";
    } catch (error) {
      dataError = error.message;
    }
  }

  if (!candles) candles = generateMockCandles({ symbol: strategySpec.symbol, timeframe: strategySpec.timeframe, count: 720, seed: 1337 });
  const result = runBacktest({ candles, strategySpec, requirements: requirements ?? {} });
  return { ok: true, dataMode, dataError, result };
}

async function hyperliquidMarketsRoute() {
  const [markets, mids] = await Promise.allSettled([hyperliquid.getMarkets(), hyperliquid.getAllMids()]);
  return {
    ok: markets.status === "fulfilled",
    markets: markets.status === "fulfilled" ? markets.value : null,
    mids: mids.status === "fulfilled" ? mids.value : null,
    errors: [markets, mids].filter((item) => item.status === "rejected").map((item) => item.reason.message),
  };
}

async function hyperliquidCandlesRoute({ symbol, timeframe, startTime, endTime }) {
  const candles = await hyperliquid.getCandles({
    symbol,
    timeframe,
    startTime: startTime ?? Date.now() - 7 * 24 * 60 * 60_000,
    endTime: endTime ?? Date.now(),
  });
  return { ok: true, candles };
}

async function getHyperliquidCandlesForSearch({ symbol, timeframe }) {
  return hyperliquid.getCandles({
    symbol,
    timeframe,
    startTime: Date.now() - 14 * 24 * 60 * 60_000,
    endTime: Date.now(),
  });
}

async function generateWithOpenRouter({ prompt, modelEnv, purpose }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env[modelEnv] ?? process.env.OPENROUTER_CHAT_MODEL ?? "openai/gpt-4.1-mini";

  if (!apiKey) return fallbackSpec(prompt);

  const completion = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:8000",
      "X-Title": process.env.OPENROUTER_APP_NAME ?? "Crypto Research Lab",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Return only JSON for a crypto StrategySpec. Do not produce backtest results. Never enable execution. Include thesis, regimeHypothesis, rules, risk, filters, indicatorsUsed, requiredDataSources, and status draft.",
        },
        { role: "user", content: `Purpose: ${purpose}. Request: ${prompt}` },
      ],
    }),
  });

  if (!completion.ok) return fallbackSpec(prompt);
  const payload = await completion.json();
  const text = payload.choices?.[0]?.message?.content;
  if (!text) return fallbackSpec(prompt);

  try {
    const parsed = JSON.parse(text);
    return parsed.strategySpec ?? parsed;
  } catch {
    return fallbackSpec(prompt);
  }
}

async function chatWithOpenRouter({ message, state }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_CHAT_MODEL;
  if (!apiKey || !model) return null;

  const completion = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:8000",
      "X-Title": process.env.OPENROUTER_APP_NAME ?? "Crypto Research Lab",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are the chat/router for a crypto research workbench. Be concise. Do not invent backtest results. Explain current capabilities and route strategy work to deterministic tools.",
        },
        { role: "user", content: `State: ${JSON.stringify(summarizeState(state))}\nMessage: ${message}` },
      ],
    }),
  });

  if (!completion.ok) return null;
  const payload = await completion.json();
  return payload.choices?.[0]?.message?.content ?? null;
}

function fallbackSpec(prompt = "") {
  const symbol = prompt.toUpperCase().includes("ETH") ? "ETH" : prompt.toUpperCase().includes("SOL") ? "SOL" : "BTC";
  return createBaseStrategySpec({
    id: `server-draft-${Date.now()}`,
    name: `${symbol} 5m Compression Breakout Draft`,
    symbol,
    requiredDataSources: ["ohlcv", "hyperliquid_candles"],
  });
}

function summarizeState(state = {}) {
  return {
    selectedStrategyId: state.selectedStrategyId ?? null,
    strategyCount: state.strategyCount ?? 0,
    lastBacktestId: state.lastBacktestId ?? null,
    liveExecution: process.env.ENABLE_LIVE_TRADING === "true" ? "configured but disabled in UI" : "disabled",
  };
}

function loadEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://localhost:${port}`);
  const rawPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(rawPath).replace(/^[/\\]+/, "").replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);
  const content = await readFile(filePath);
  response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream" });
  response.end(content);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
