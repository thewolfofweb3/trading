import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createBaseStrategySpec } from "./src/strategy/schema.js";

const port = Number(process.env.PORT ?? 8000);
const root = process.cwd();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/strategy/generate") {
      const body = await readJson(request);
      const strategySpec = await generateWithOpenRouter(body.prompt);
      sendJson(response, { strategySpec, source: process.env.OPENROUTER_API_KEY ? "openrouter" : "local-server-fallback" });
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    sendJson(response, { error: error.message }, 500);
  }
}).listen(port, () => {
  console.log(`Crypto research lab running on http://localhost:${port}`);
});

async function generateWithOpenRouter(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL ?? "openai/gpt-4.1-mini";

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
            "Return only JSON for a crypto strategy spec. Do not produce backtest results. Execution must be disabled. Favor price-action, volatility, regime, VWAP/EMA, ATR, session, funding, and relative-strength filters.",
        },
        {
          role: "user",
          content: `Create a structured strategySpec for this request: ${prompt}`,
        },
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

function fallbackSpec(prompt = "") {
  const symbol = prompt.toUpperCase().includes("ETH") ? "ETH" : prompt.toUpperCase().includes("SOL") ? "SOL" : "BTC";
  return createBaseStrategySpec({
    id: `server-draft-${Date.now()}`,
    name: `${symbol} 5m Compression Breakout Draft`,
    symbol,
    requiredDataSources: ["ohlcv", "hyperliquid_candles"],
  });
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
