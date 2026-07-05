import { generateStrategySpecFromPrompt } from "./ai/strategy-generator.js";
import { generateMockCandles } from "./data/mock-candles.js";
import { runBacktest } from "./backtest/engine.js";

export const appState = {
  mode: "empty",
  strategySpec: null,
  backtest: null,
  compare: [],
  dataMode: "mock",
};

export function initApp() {
  const dom = getDom();
  render(dom);

  dom.composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    const prompt = dom.textarea.value.trim();
    if (!prompt) return;

    appendUserMessage(dom, prompt);
    dom.textarea.value = "";
    setWorking(dom, "Generating structured strategy spec...");

    try {
      const { spec, validation, source } = await generateStrategySpecFromPrompt(prompt);
      appState.mode = "draft";
      appState.strategySpec = spec;
      appState.backtest = null;
      render(dom);
      appendAiText(dom, `Draft strategy spec created (${source}). Review the rules, then run a mock backtest.`);
      if (validation.warnings.length) appendAiText(dom, `Warnings: ${validation.warnings.join(" ")}`);
    } catch (error) {
      appendAiText(dom, `Could not create a valid strategy spec: ${error.message}`);
    } finally {
      setWorking(dom, "");
    }
  });

  dom.runButton.addEventListener("click", () => {
    if (!appState.strategySpec) return;
    const candles = generateMockCandles({
      symbol: appState.strategySpec.symbol,
      timeframe: appState.strategySpec.timeframe,
      count: 720,
      seed: 1337,
    });
    appState.backtest = runBacktest({ candles, strategySpec: appState.strategySpec });
    appState.mode = "backtest";
    render(dom);
    appendAiText(dom, "Mock backtest complete. Real Hyperliquid candles are not wired into this run yet.");
  });
}

function getDom() {
  return {
    shell: document.querySelector(".app-shell"),
    composer: document.querySelector(".composer"),
    textarea: document.querySelector("textarea"),
    chat: document.querySelector(".chat-empty"),
    editorTabName: document.querySelector(".editor-tab .file-name"),
    editorSurface: document.querySelector(".editor-surface"),
    runButton: document.querySelector(".run-button"),
    lineGutter: document.querySelector(".line-gutter"),
  };
}

function render(dom) {
  dom.shell.classList.toggle("active-strategy", appState.mode !== "empty");
  dom.shell.dataset.state = appState.mode;

  if (appState.mode === "empty") {
    renderEmpty(dom);
    return;
  }

  dom.editorTabName.textContent = `${appState.strategySpec.symbol.toLowerCase()}_${appState.strategySpec.timeframe}_strategy.json`;
  dom.editorSurface.innerHTML = `
    ${lineGutterMarkup()}
    <div class="workspace-document">
      ${strategySpecMarkup(appState.strategySpec)}
      ${appState.backtest ? backtestMarkup(appState.backtest) : ""}
      <section class="execution-guard">
        <span>Execution disabled</span>
        <p>Live trading, webhooks, and exchange API execution require paper trading, explicit confirmation, max loss guard, and kill switch.</p>
      </section>
    </div>
  `;
  dom.lineGutter = dom.editorSurface.querySelector(".line-gutter");
}

function renderEmpty(dom) {
  dom.editorSurface.innerHTML = `
    ${lineGutterMarkup()}
    <div class="canvas-placeholder">
      <div class="mark" aria-hidden="true">
        <span></span><span></span><span></span><span></span>
      </div>
      <div class="shortcuts" aria-label="Keyboard shortcuts">
        <div><span>Toggle file tree</span><kbd>Ctrl</kbd><em>+</em><kbd>B</kbd></div>
        <div><span>Toggle editor</span><kbd>Ctrl</kbd><em>+</em><kbd>Alt</kbd><em>+</em><kbd>E</kbd></div>
        <div><span>New file</span><kbd>Ctrl</kbd><em>+</em><kbd>Alt</kbd><em>+</em><kbd>N</kbd></div>
        <div><span>New chat</span><kbd>Ctrl</kbd><em>+</em><kbd>Shift</kbd><em>+</em><kbd>L</kbd></div>
      </div>
    </div>
  `;
}

function lineGutterMarkup() {
  return `<ol class="line-gutter" aria-hidden="true">${Array.from({ length: 18 }, (_, index) => `<li>${index + 1}</li>`).join("")}</ol>`;
}

function strategySpecMarkup(spec) {
  return `
    <section class="strategy-spec-view">
      <header>
        <span>Strategy draft</span>
        <strong>${escapeHtml(spec.name)}</strong>
      </header>
      <pre><code>${escapeHtml(JSON.stringify(spec, null, 2))}</code></pre>
    </section>
  `;
}

function backtestMarkup(result) {
  const metrics = result.metrics;
  return `
    <section class="backtest-view">
      <header>
        <span>Mock backtest</span>
        <strong>${result.dataMode === "mock" ? "Mock OHLCV - infrastructure test" : "Historical data"}</strong>
      </header>
      <div class="metrics-grid">
        ${metric("Net P&L", formatCurrency(metrics.netPnl))}
        ${metric("Win rate", formatPercent(metrics.winRate))}
        ${metric("Max DD", formatPercent(metrics.maxDrawdown))}
        ${metric("Profit factor", finite(metrics.profitFactor))}
        ${metric("Average R", metrics.averageR.toFixed(2))}
        ${metric("Fees", formatCurrency(metrics.fees))}
        ${metric("Slippage", `${metrics.slippageBps} bps`)}
        ${metric("Trades", metrics.tradeCount)}
        ${metric("Prop rules", metrics.propRules.pass ? "PASS" : "FAIL")}
      </div>
      <div class="placeholder-grid">
        <div>Equity curve placeholder</div>
        <div>Trade list placeholder</div>
      </div>
      ${result.warnings.map((warning) => `<p class="warning">${escapeHtml(warning)}</p>`).join("")}
    </section>
  `;
}

function metric(label, value) {
  return `<div><span>${label}</span><strong>${value}</strong></div>`;
}

function appendUserMessage(dom, message) {
  dom.chat.classList.add("has-thread");
  const bubble = document.createElement("div");
  bubble.className = "user-message";
  bubble.textContent = message;
  dom.chat.appendChild(bubble);
}

function appendAiText(dom, message) {
  const line = document.createElement("p");
  line.className = "ai-message";
  line.textContent = message;
  dom.chat.appendChild(line);
}

function setWorking(dom, message) {
  dom.shell.dataset.working = message ? "true" : "false";
  dom.runButton.disabled = Boolean(message);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function finite(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "Inf";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
