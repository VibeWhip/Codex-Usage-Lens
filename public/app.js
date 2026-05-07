const POLL_MS = 5000;
const TICK_MS = 1000;
const hero = document.querySelector("#hero");
const summary = document.querySelector("#summary");
const statusEl = document.querySelector("#status");
const lastUpdated = document.querySelector("#last-updated");
const CACHE_KEY = "codex-usage-lens:last-good-snapshot";
let lastData = null;
let lastError = null;

function pct(value) {
  return `${Number(value).toFixed(1)}%`;
}

function formatDate(ms) {
  if (!ms) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(ms));
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "已到重置时间";
  const totalSeconds = Math.ceil(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}天 ${hours}小时 ${minutes}分`;
  if (hours > 0) return `${hours}小时 ${minutes}分`;
  if (minutes > 0) return `${minutes}分 ${seconds}秒`;
  return `${seconds}秒`;
}

function setStatus(text, mode) {
  statusEl.className = `status ${mode || ""}`;
  statusEl.querySelector("span:last-child").textContent = text;
}

function readCachedData() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return isRenderable(data) ? data : null;
  } catch {
    return null;
  }
}

function writeCachedData(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage failures; live rendering should continue.
  }
}

function isRenderable(data) {
  return Boolean(data?.ok && Array.isArray(data.limits) && data.limits.length > 0);
}

function windowTile(window, title, tone) {
  const remaining = window.remainingPercent;
  const used = window.usedPercent;
  const resetIn = formatDuration(window.resetsAt - Date.now());
  const resetAt = formatDate(window.resetsAt);

  return `
    <article class="quota-tile ${tone || ""}">
      <div class="tile-copy">
        <p class="tile-eyebrow">${title}</p>
        <h2>${pct(remaining)}</h2>
        <p class="tile-subtitle">已用 ${pct(used)} · ${resetIn} 后重置</p>
      </div>
      <div class="meter" aria-label="${title} 剩余额度">
        <span style="width: ${remaining}%"></span>
      </div>
      <dl class="metrics">
        <div>
          <dt>已用</dt>
          <dd>${pct(used)}</dd>
        </div>
        <div>
          <dt>重置倒计时</dt>
          <dd>${resetIn}</dd>
        </div>
        <div>
          <dt>重置时间</dt>
          <dd>${resetAt}</dd>
        </div>
      </dl>
    </article>
  `;
}

function render(data) {
  lastData = data;

  if (!isRenderable(data)) {
    hero.innerHTML = "";
    summary.innerHTML = `
      <article class="empty">
        <h2>暂无额度记录</h2>
        <p>本地 session 里还没有找到 Codex rate_limits 事件。</p>
      </article>
    `;
    lastUpdated.textContent = formatDate(Date.now());
    setStatus("无数据", "warn");
    return;
  }

  const primaryLimit = data.limits.find((limit) => limit.limitId === "codex") || data.limits[0];
  const primary = primaryLimit.primary;
  const secondary = primaryLimit.secondary;
  const isLive = data.source === "live-api";
  const sourceText = data.sourceLabel || (isLive ? "Codex 实时使用接口" : "本地 session 快照");
  const sourceStatus = isLive ? "实时接口" : "本地快照";
  const sourceMode = isLive ? "ok" : "warn";

  hero.innerHTML = `
    <div class="hero-copy">
      <p class="eyebrow">Codex Usage Lens</p>
      <h1>Codex 额度剩余</h1>
      <p class="hero-subtitle">
        当前 5 小时主额度剩余 ${pct(primary.remainingPercent)}，${isLive ? "每 5 秒读取 Codex 实时使用接口。" : "当前为本地快照兜底，可能不准。"}
      </p>
      <p class="hero-link">${sourceText} · ${formatDate(Date.parse(primaryLimit.capturedAt || data.generatedAt))} <span aria-hidden="true">›</span></p>
    </div>
  `;

  summary.innerHTML = [
    windowTile(primary, "5 小时主额度", "dark-tile"),
    windowTile(secondary, "1 周主额度", "light-tile")
  ].join("");

  lastUpdated.textContent = `Codex / ${primaryLimit.planType || "current"} / ${sourceStatus} / 更新于 ${formatDate(Date.parse(data.generatedAt))}`;
  setStatus(sourceStatus, sourceMode);
}

function renderOffline(error) {
  lastError = error;

  if (lastData) {
    render(lastData);
    setStatus("重连中", "warn");
    lastUpdated.textContent = `${lastUpdated.textContent} / 本地服务重连中`;
    return;
  }

  const cached = readCachedData();
  if (cached) {
    render(cached);
    lastData = cached;
    setStatus("缓存数据", "warn");
    lastUpdated.textContent = `${lastUpdated.textContent} / 本地服务重连中`;
    return;
  }

  hero.innerHTML = `
    <div class="hero-copy">
      <p class="eyebrow">Codex Usage Lens</p>
      <h1>本地服务未连接</h1>
      <p class="hero-subtitle">页面会继续自动重试。请确认本地服务正在运行。</p>
    </div>
  `;
  summary.innerHTML = `
    <article class="empty">
      <h2>等待本地服务</h2>
      <p>运行 npm start 后，页面会自动恢复显示额度。</p>
    </article>
  `;
  lastUpdated.textContent = `上次尝试 ${formatDate(Date.now())}`;
  setStatus("重连中", "warn");
}

async function refresh() {
  try {
    const response = await fetch(`/api/quota?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    lastError = null;
    if (isRenderable(data)) {
      writeCachedData(data);
    }
    render(data);
  } catch (error) {
    renderOffline(error);
  }
}

lastData = readCachedData();
if (lastData) {
  render(lastData);
  setStatus("缓存数据", "warn");
}

refresh();
setInterval(refresh, POLL_MS);
setInterval(() => {
  if (lastData) {
    render(lastData);
    if (lastError) {
      setStatus("重连中", "warn");
      lastUpdated.textContent = `${lastUpdated.textContent} / 本地服务重连中`;
    }
  }
}, TICK_MS);
