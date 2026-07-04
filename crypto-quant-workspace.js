const markets = {
  "BTC-PERP": {
    title: "BTC breakout verifier",
    prompt:
      "Pull BTC perpetuals across Binance, Bybit, and Coinbase. Build a 5m breakout strategy, then test whether it survives a 100K crypto prop challenge with a 5% daily loss rule and 10% target.",
    metrics: ["$18,420", "4.8%", "61%", "72%"],
  },
  "ETH-PERP": {
    title: "ETH funding mean reversion",
    prompt:
      "Compare ETH perp funding extremes against spot momentum. Draft a mean-reversion system and check whether overnight gaps break the funded-account daily loss rule.",
    metrics: ["$9,860", "3.9%", "58%", "64%"],
  },
  "SOL-PERP": {
    title: "SOL volatility expansion",
    prompt:
      "Scan SOL perpetual liquidity, define a volatility expansion entry, and estimate pass odds for a 50K crypto challenge with a trailing drawdown.",
    metrics: ["$12,115", "6.2%", "54%", "57%"],
  },
};

const title = document.querySelector(".chart-head h1");
const promptCard = document.querySelector(".prompt-card");
const metricValues = document.querySelectorAll(".chart-metrics strong");
const marketButtons = document.querySelectorAll(".market-row");
const runButton = document.querySelector(".toolbar-button.primary");
const textarea = document.querySelector("textarea");
const sendButton = document.querySelector(".send-button");
const assistantLine = document.querySelector(".assistant-line");

function selectMarket(button) {
  const symbol = button.querySelector("span").textContent;
  const market = markets[symbol];
  if (!market) return;

  marketButtons.forEach((item) => item.classList.remove("selected"));
  button.classList.add("selected");
  title.textContent = market.title;
  promptCard.textContent = market.prompt;
  metricValues.forEach((value, index) => {
    value.textContent = market.metrics[index];
  });
}

marketButtons.forEach((button) => {
  button.addEventListener("click", () => selectMarket(button));
});

runButton.addEventListener("click", () => {
  runButton.classList.add("is-running");
  runButton.querySelector("span").textContent = "Running";
  assistantLine.textContent = "Running candles, fees, slippage, funding, and challenge rules through the draft strategy.";

  window.setTimeout(() => {
    runButton.querySelector("span").textContent = "Run";
    runButton.classList.remove("is-running");
    assistantLine.textContent = "Backtest finished. The current draft clears the target in most paths, but the drawdown guard needs tighter position sizing before live deployment.";
  }, 1200);
});

sendButton.addEventListener("click", () => {
  const message = textarea.value.trim();
  if (!message) return;

  promptCard.textContent = message;
  textarea.value = "";
  assistantLine.textContent = "Got it. I'll turn that into strategy edits, run the crypto challenge simulation, and explain the risk changes.";
});
