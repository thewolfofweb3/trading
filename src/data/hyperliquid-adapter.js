export class HyperliquidDataAdapter {
  constructor({ baseUrl = "https://api.hyperliquid.xyz/info" } = {}) {
    this.baseUrl = baseUrl;
    this.name = "hyperliquid";
  }

  async getCandles({ symbol, timeframe, startTime, endTime }) {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "candleSnapshot",
        req: {
          coin: symbol,
          interval: timeframe,
          startTime,
          endTime,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Hyperliquid candle request failed: ${response.status}`);
    }

    const rows = await response.json();
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
