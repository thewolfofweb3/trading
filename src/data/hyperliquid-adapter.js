export class HyperliquidDataAdapter {
  constructor({ apiUrl = "https://api.hyperliquid.xyz" } = {}) {
    this.apiUrl = apiUrl.replace(/\/$/, "");
    this.baseUrl = `${this.apiUrl}/info`;
    this.name = "hyperliquid";
  }

  async getMarkets() {
    const [meta, spotMeta] = await Promise.allSettled([
      this.info({ type: "meta" }),
      this.info({ type: "spotMeta" }),
    ]);

    const perps = meta.status === "fulfilled"
      ? (meta.value.universe ?? []).map((market) => ({ symbol: market.name, type: "perp", raw: market }))
      : [];
    const spot = spotMeta.status === "fulfilled"
      ? (spotMeta.value.universe ?? []).map((market) => ({ symbol: market.name ?? `${market.tokens?.[0]}-${market.tokens?.[1]}`, type: "spot", raw: market }))
      : [];

    return { perps, spot, errors: [meta, spotMeta].filter((item) => item.status === "rejected").map((item) => item.reason.message) };
  }

  async getAllMids() {
    return this.info({ type: "allMids" });
  }

  async getCandles({ symbol, timeframe, startTime, endTime }) {
    const rows = await this.info({
      type: "candleSnapshot",
      req: {
        coin: symbol,
        interval: timeframe,
        startTime,
        endTime,
      },
    });

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error(`Hyperliquid returned no candle data for ${symbol} ${timeframe}.`);
    }

    return rows.map((row) => ({
      time: row.t,
      open: Number(row.o),
      high: Number(row.h),
      low: Number(row.l),
      close: Number(row.c),
      volume: Number(row.v ?? 0),
      source: "hyperliquid",
    }));
  }

  createWebSocketPlan() {
    return {
      status: "planned",
      channels: ["trades", "candle", "l2Book"],
      note: "WebSocket live trades/candles/order book will be added after HTTP backtesting is stable.",
    };
  }

  async info(payload) {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Hyperliquid info request failed: ${response.status}`);
    }

    return response.json();
  }

  async getFundingRates() {
    throw new Error("Hyperliquid funding adapter is planned but not wired in this MVP.");
  }

  async getOpenInterest() {
    throw new Error("Hyperliquid open interest adapter is planned but not wired in this MVP.");
  }
}

export const futureAdapters = {
  binance: "planned",
  coinbaseAdvancedTrade: "planned",
  bybit: "planned",
};
