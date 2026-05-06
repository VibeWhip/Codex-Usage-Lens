const POLL_MS = 5000;
const TICK_MS = 1000;
const hero = document.querySelector("#hero");
const summary = document.querySelector("#summary");
const statusEl = document.querySelector("#status");
const lastUpdated = document.querySelector("#last-updated");
let lastData = null;

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

  if (!data.ok || data.limits.length === 0) {
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

async function refresh() {
  try {
    const response = await fetch(`/api/quota?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch (error) {
    setStatus("读取失败", "error");
    summary.innerHTML = `
      <article class="empty">
        <h2>读取失败</h2>
        <p>${error.message}</p>
      </article>
    `;
  }
}

refresh();
setInterval(refresh, POLL_MS);
setInterval(() => {
  if (lastData) {
    render(lastData);
  }
}, TICK_MS);
