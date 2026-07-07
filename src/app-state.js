export const appState = {
  mode: "empty",
  selectedStrategyId: null,
  strategies: loadStrategies(),
  lastRequirements: null,
  apiStatus: { hyperliquid: "unknown", openRouter: "server-side" },
};

export function initApp() {
  const dom = getDom();
  render(dom);
  bindComposer(dom);
  bindShortcuts(dom);
  bindWorkspace(dom);

  dom.runButton.addEventListener("click", () => runSelectedBacktest(dom));
  dom.newChatButton?.addEventListener("click", () => newResearchThread(dom));
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
    fileList: document.querySelector(".file-list"),
    workspaceRail: document.querySelector(".workspace-rail"),
    newChatButton: document.querySelector('[aria-label="New chat"]'),
  };
}

function bindComposer(dom) {
  dom.composer.addEventListener("submit", (event) => {
    event.preventDefault();
    submitPrompt(dom);
  });

  dom.textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitPrompt(dom);
    }
  });
}

function bindShortcuts(dom) {
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (event.ctrlKey && !event.altKey && !event.shiftKey && key === "b") {
      event.preventDefault();
      dom.workspaceRail.classList.toggle("collapsed");
      return;
    }
    if (event.ctrlKey && event.altKey && key === "n") {
      event.preventDefault();
      createBlankStrategy(dom);
      return;
    }
    if (event.ctrlKey && event.shiftKey && key === "l") {
      event.preventDefault();
      newResearchThread(dom);
    }
  });
}

function bindWorkspace(dom) {
  dom.fileList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-strategy-id]");
    if (!button) return;
    selectStrategy(dom, button.dataset.strategyId);
  });
}

async function submitPrompt(dom) {
  const prompt = dom.textarea.value.trim();
  if (!prompt) return;
  appendUserMessage(dom, prompt);
  dom.textarea.value = "";

  try {
    if (/delete|archive/.test(prompt.toLowerCase()) && appState.selectedStrategyId) {
      archiveSelected(dom);
      return;
    }

    if (/find another|continue searching/.test(prompt.toLowerCase()) && appState.lastRequirements) {
      await searchFromPrompt(dom, prompt, appState.lastRequirements);
      return;
    }

    if (/analy[sz]e|find me|above|win rate|drawdown|search|optimi[sz]e|another strategy/i.test(prompt)) {
      await searchFromPrompt(dom, prompt);
      return;
    }

    if (/create|build|generate|strategy/i.test(prompt)) {
      await generateStrategy(dom, prompt);
      return;
    }

    if (/what can you do|help|capabilities/i.test(prompt)) {
      const reply = await postJson("/api/chat", { message: prompt, state: summarizeState() });
      appendToolMessage(dom, "Capabilities", reply.message);
      return;
    }

    const reply = await postJson("/api/chat", { message: prompt, state: summarizeState() });
    appendAiText(dom, reply.message);
  } catch (error) {
    appendToolMessage(dom, "API/setup error", error.message, "error");
  }
}

async function generateStrategy(dom, prompt) {
  setWorking(dom, true);
  appendStatus(dom, "Strategy generation", "Creating structured strategy spec...");
  const payload = await postJson("/api/strategy/generate", { prompt });
  const strategy = normalizeStoredStrategy(payload.strategySpec, { source: payload.source });
  saveStrategy(strategy);
  selectStrategy(dom, strategy.id);
  appendStrategyCard(dom, "Strategy created", strategy, `Generated from ${payload.source}. Execution remains disabled.`);
  setWorking(dom, false);
}

async function searchFromPrompt(dom, prompt, previousRequirements = null) {
  setWorking(dom, true);
  appendStatus(dom, "Market data", "Loading Hyperliquid candles and searching deterministic candidates...");
  const payload = await postJson("/api/strategy/search", { prompt, requirements: previousRequirements });
  appState.lastRequirements = payload.requirements;

  for (const candidate of payload.candidates) {
    saveStrategy(normalizeStoredStrategy(candidate.spec, { backtest: candidate.backtest, source: payload.dataMode }));
  }

  const chosen = payload.passed ?? payload.best;
  if (chosen?.spec?.id) selectStrategy(dom, chosen.spec.id);
  appendSearchSummary(dom, payload);
  setWorking(dom, false);
}

async function runSelectedBacktest(dom) {
  const strategy = selectedStrategy();
  if (!strategy) return;
  setWorking(dom, true);
  appendStatus(dom, "Backtest running", `${strategy.symbol} ${strategy.timeframe} deterministic test...`);
  const payload = await postJson("/api/backtest/run", {
    strategySpec: strategy,
    requirements: appState.lastRequirements ?? {},
    useHyperliquid: false,
  });
  strategy.backtest = payload.result;
  strategy.status = payload.result.metrics.propRules.pass ? "passed" : "failed";
  saveStrategy(strategy);
  appState.mode = "backtest";
  render(dom);
  appendBacktestCard(dom, strategy, payload);
  setWorking(dom, false);
}

function createBlankStrategy(dom) {
  const strategy = normalizeStoredStrategy({
    id: `draft-${Date.now()}`,
    name: "Untitled Strategy Draft",
    symbol: "BTC",
    timeframe: "5m",
    status: "draft",
    entryRules: [],
    exitRules: [],
    filters: [],
    indicatorsUsed: [],
    requiredDataSources: ["ohlcv", "hyperliquid_candles"],
    execution: { enabled: false, status: "Execution disabled", requirements: ["paper trading first", "kill switch"] },
  });
  saveStrategy(strategy);
  selectStrategy(dom, strategy.id);
  appendStrategyCard(dom, "Strategy file created", strategy, "Blank draft created. Ask the AI to fill or refine it.");
}

function newResearchThread(dom) {
  dom.chat.innerHTML = "";
  dom.chat.classList.remove("has-thread");
  appendStatus(dom, "New research thread", "Context cleared. Stored strategies remain in the workspace.");
}

function archiveSelected(dom) {
  const strategy = selectedStrategy();
  if (!strategy) return;
  strategy.status = "archived";
  saveStrategy(strategy);
  appendToolMessage(dom, "Strategy archived", `${strategy.name} moved to archived state.`);
  render(dom);
}

function selectStrategy(dom, id) {
  appState.selectedStrategyId = id;
  const strategy = selectedStrategy();
  appState.mode = strategy?.backtest ? "backtest" : "draft";
  render(dom);
}

function render(dom) {
  renderWorkspace(dom);
  const strategy = selectedStrategy();
  dom.shell.classList.toggle("active-strategy", Boolean(strategy));
  dom.shell.classList.toggle("workspace-collapsed", dom.workspaceRail.classList.contains("collapsed"));
  dom.shell.dataset.state = strategy ? appState.mode : "empty";

  if (!strategy) {
    renderEmpty(dom);
    return;
  }

  dom.editorTabName.textContent = `${strategy.symbol.toLowerCase()}_${strategy.timeframe}_strategy.json`;
  dom.editorSurface.innerHTML = `
    ${lineGutterMarkup()}
    <div class="workspace-document">
      ${strategySpecMarkup(strategy)}
      ${strategy.backtest ? backtestMarkup(strategy.backtest) : ""}
      ${actionsMarkup(strategy)}
      <section class="execution-guard">
        <span>Execution disabled</span>
        <p>Paper trading, exchange API keys, explicit confirmation, max loss guard, and kill switch are required before any future execution.</p>
      </section>
    </div>
  `;
  dom.editorSurface.querySelector("[data-action='rerun']")?.addEventListener("click", () => runSelectedBacktest(dom));
  dom.editorSurface.querySelector("[data-action='save']")?.addEventListener("click", () => {
    const strategy = selectedStrategy();
    if (!strategy) return;
    saveStrategy(strategy);
    appendToolMessage(dom, "Strategy saved", `${strategy.name} is stored in the workspace.`);
    render(dom);
  });
  dom.editorSurface.querySelector("[data-action='refine']")?.addEventListener("click", () => {
    const strategy = selectedStrategy();
    if (!strategy) return;
    dom.textarea.value = `Refine ${strategy.name}: improve risk/reward while keeping max drawdown controlled.`;
    dom.textarea.focus();
  });
  dom.editorSurface.querySelector("[data-action='archive']")?.addEventListener("click", () => archiveSelected(dom));
}

function renderWorkspace(dom) {
  const staticRows = `
    <button class="file-row" type="button"><span>README.md</span></button>
    <button class="file-row" type="button"><span>strategies/</span></button>
    <button class="file-row" type="button"><span>data/</span></button>
    <button class="file-row" type="button"><span>backtests/</span></button>
  `;
  const strategyRows = appState.strategies
    .filter((strategy) => strategy.status !== "archived")
    .map((strategy) => `
      <button class="file-row strategy-row ${strategy.id === appState.selectedStrategyId ? "active" : ""}" type="button" data-strategy-id="${strategy.id}">
        <span>${escapeHtml(strategy.symbol)}_${escapeHtml(strategy.timeframe)}</span>
        <small class="status-badge ${strategy.status}">${strategy.status}</small>
      </button>
    `).join("");
  dom.fileList.innerHTML = staticRows + strategyRows;
}

function renderEmpty(dom) {
  dom.editorSurface.innerHTML = `
    ${lineGutterMarkup()}
    <div class="canvas-placeholder">
      <div class="mark" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <div class="shortcuts" aria-label="Keyboard shortcuts">
        <div><span>Toggle file tree</span><kbd>Ctrl</kbd><em>+</em><kbd>B</kbd></div>
        <div><span>New strategy</span><kbd>Ctrl</kbd><em>+</em><kbd>Alt</kbd><em>+</em><kbd>N</kbd></div>
        <div><span>New chat</span><kbd>Ctrl</kbd><em>+</em><kbd>Shift</kbd><em>+</em><kbd>L</kbd></div>
      </div>
    </div>
  `;
}

function lineGutterMarkup() {
  return `<ol class="line-gutter" aria-hidden="true">${Array.from({ length: 28 }, (_, index) => `<li>${index + 1}</li>`).join("")}</ol>`;
}

function strategySpecMarkup(strategy) {
  const visible = { ...strategy };
  delete visible.backtest;
  return `
    <section class="strategy-spec-view">
      <header><span>Strategy ${strategy.status}</span><strong>${escapeHtml(strategy.name)}</strong></header>
      <pre><code>${escapeHtml(JSON.stringify(visible, null, 2))}</code></pre>
    </section>
  `;
}

function backtestMarkup(result) {
  const metrics = result.metrics;
  return `
    <section class="backtest-view">
      <header><span>${result.dataMode === "mock" ? "Mock backtest" : "Hyperliquid backtest"}</span><strong>${metrics.propRules.pass ? "PASS" : "FAIL"}</strong></header>
      <div class="metrics-grid">
        ${metric("Net P&L", formatCurrency(metrics.netPnl))}
        ${metric("Win rate", formatPercent(metrics.winRate))}
        ${metric("Loss rate", formatPercent(metrics.lossRate))}
        ${metric("Avg win", formatCurrency(metrics.averageWin))}
        ${metric("Avg loss", formatCurrency(metrics.averageLoss))}
        ${metric("Risk/reward", finite(metrics.riskReward))}
        ${metric("Profit factor", finite(metrics.profitFactor))}
        ${metric("Max DD", formatPercent(metrics.maxDrawdown))}
        ${metric("Expectancy", formatCurrency(metrics.expectancy))}
        ${metric("Losing streak", metrics.longestLosingStreak)}
        ${metric("Fees", formatCurrency(metrics.fees))}
        ${metric("Trades", metrics.tradeCount)}
      </div>
      <div class="equity-chart">${equitySvg(result.equityCurve)}</div>
      <table class="trades-table">
        <thead><tr><th>Exit</th><th>P&L</th><th>R</th><th>Reason</th></tr></thead>
        <tbody>${result.trades.slice(-8).map((trade) => `<tr><td>${new Date(trade.exitTime).toISOString().slice(5, 16)}</td><td>${formatCurrency(trade.pnl)}</td><td>${trade.rMultiple.toFixed(2)}</td><td>${escapeHtml(trade.reason)}</td></tr>`).join("")}</tbody>
      </table>
      ${result.warnings.map((warning) => `<p class="warning">${escapeHtml(warning)}</p>`).join("")}
    </section>
  `;
}

function actionsMarkup() {
  return `
    <div class="workspace-actions">
      <button data-action="refine" type="button">Refine</button>
      <button data-action="rerun" type="button">Rerun</button>
      <button data-action="save" type="button">Save</button>
      <button data-action="archive" type="button">Archive/Delete</button>
    </div>
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

function appendStatus(dom, title, message) {
  appendToolMessage(dom, title, message, "status");
}

function appendToolMessage(dom, title, message, type = "status") {
  const card = document.createElement("div");
  card.className = `tool-message ${type}`;
  card.innerHTML = `<strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p>`;
  dom.chat.appendChild(card);
  dom.chat.classList.add("has-thread");
}

function appendStrategyCard(dom, title, strategy, body) {
  const card = document.createElement("div");
  card.className = "tool-message strategy";
  card.innerHTML = `<strong>${escapeHtml(title)}</strong><p>${escapeHtml(strategy.name)} - ${escapeHtml(strategy.symbol)} ${escapeHtml(strategy.timeframe)}</p><p>${escapeHtml(body)}</p>`;
  dom.chat.appendChild(card);
}

function appendBacktestCard(dom, strategy, payload) {
  const metrics = payload.result.metrics;
  appendToolMessage(dom, metrics.propRules.pass ? "Strategy passed" : "Candidate failed", `${strategy.name}: win ${formatPercent(metrics.winRate)}, max DD ${formatPercent(metrics.maxDrawdown)}, PF ${finite(metrics.profitFactor)}.`, metrics.propRules.pass ? "pass" : "fail");
}

function appendSearchSummary(dom, payload) {
  const best = payload.best;
  const passed = payload.passed;
  const title = passed ? "Strategy passed" : "No passing strategy found";
  const dataNote = payload.dataMode === "mock" ? ` Hyperliquid unavailable: ${payload.dataError ?? "using mock candles"}.` : " Hyperliquid data loaded.";
  const body = best
    ? `${payload.candidates.length} candidates tested.${dataNote} Best: ${best.spec.name} (${best.spec.status}) win ${formatPercent(best.backtest.metrics.winRate)}, DD ${formatPercent(best.backtest.metrics.maxDrawdown)}.`
    : `No candidates were produced.${dataNote}`;
  appendToolMessage(dom, title, body, passed ? "pass" : "fail");
}

function setWorking(dom, working) {
  dom.shell.dataset.working = working ? "true" : "false";
  dom.runButton.disabled = working;
}

function saveStrategy(strategy) {
  const existing = appState.strategies.findIndex((item) => item.id === strategy.id);
  if (existing >= 0) appState.strategies[existing] = strategy;
  else appState.strategies.push(strategy);
  persistStrategies();
}

function selectedStrategy() {
  return appState.strategies.find((strategy) => strategy.id === appState.selectedStrategyId) ?? null;
}

function normalizeStoredStrategy(strategy, extra = {}) {
  return {
    thesis: "",
    regimeHypothesis: "",
    entryRules: [],
    exitRules: [],
    filters: [],
    indicatorsUsed: [],
    requiredDataSources: ["ohlcv"],
    createdAt: new Date().toISOString(),
    status: "draft",
    ...strategy,
    ...extra,
  };
}

function loadStrategies() {
  try {
    return JSON.parse(localStorage.getItem("crypto-lab-strategies") ?? "[]");
  } catch {
    return [];
  }
}

function persistStrategies() {
  localStorage.setItem("crypto-lab-strategies", JSON.stringify(appState.strategies));
}

function summarizeState() {
  return {
    selectedStrategyId: appState.selectedStrategyId,
    strategyCount: appState.strategies.length,
    lastBacktestId: selectedStrategy()?.backtest ? appState.selectedStrategyId : null,
  };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.error ?? `Request failed: ${response.status}`);
  return payload;
}

function equitySvg(curve = []) {
  if (curve.length < 2) return "<span>Equity curve placeholder</span>";
  const width = 520;
  const height = 120;
  const min = Math.min(...curve.map((point) => point.equity));
  const max = Math.max(...curve.map((point) => point.equity));
  const span = max - min || 1;
  const points = curve.map((point, index) => {
    const x = (index / (curve.length - 1)) * width;
    const y = height - ((point.equity - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Equity curve"><polyline points="${points}" /></svg>`;
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
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
