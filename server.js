import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProxyAgent, request } from "undici";

const APP_NAME = "Codex Usage Lens";
const HOST = process.env.HOST || "127.0.0.1";
const START_PORT = Number(process.env.PORT || 8787);
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const SESSIONS_DIR = path.join(CODEX_HOME, "sessions");
const AUTH_FILE = path.join(CODEX_HOME, "auth.json");
const PUBLIC_DIR = path.join(process.cwd(), "public");
const LIVE_USAGE_URL = process.env.CODEX_USAGE_URL || "https://chatgpt.com/backend-api/wham/usage";
const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || null;
const LIVE_DISPATCHER = PROXY_URL ? new ProxyAgent({ uri: PROXY_URL }) : undefined;
const LIVE_CACHE_MS = Number(process.env.LIVE_CACHE_MS || 4000);
const FALLBACK_CACHE_MS = Number(process.env.FALLBACK_CACHE_MS || 1500);

const WINDOW_NAMES = {
  300: "5 hours",
  10080: "1 week"
};

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

let cache = {
  expiresAt: 0,
  payload: null
};

async function listJsonlFiles(dir) {
  const out = [];

  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const details = await stat(fullPath);
        out.push({ path: fullPath, mtimeMs: details.mtimeMs, size: details.size });
      }
    }));
  }

  await walk(dir);
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 40);
}

async function readTail(filePath, size, maxBytes = 4 * 1024 * 1024) {
  const start = Math.max(0, size - maxBytes);
  const chunks = [];

  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { start, end: size - 1, encoding: "utf8" });
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  return chunks.join("");
}

function parseRateLimitLine(line) {
  if (!line.includes('"rate_limits"') || line.length > 1_500_000) {
    return null;
  }

  try {
    const event = JSON.parse(line);
    if (event?.type !== "event_msg" || event?.payload?.type !== "token_count") {
      return null;
    }

    const rateLimits = event?.payload?.rate_limits;
    if (!rateLimits?.primary || !rateLimits?.secondary) {
      return null;
    }

    const capturedAtMs = Date.parse(event.timestamp || "");
    if (!Number.isFinite(capturedAtMs)) {
      return null;
    }

    return {
      capturedAt: event.timestamp || null,
      capturedAtMs,
      limitId: rateLimits.limit_id || "codex",
      limitName: rateLimits.limit_name || "Codex",
      planType: rateLimits.plan_type || null,
      reachedType: rateLimits.rate_limit_reached_type || null,
      primary: normalizeWindow(rateLimits.primary),
      secondary: normalizeWindow(rateLimits.secondary)
    };
  } catch {
    return null;
  }
}

function normalizeWindow(window) {
  const usedPercent = clamp(Number(window.used_percent ?? 0), 0, 100);
  const remainingPercent = clamp(100 - usedPercent, 0, 100);

  return {
    label: WINDOW_NAMES[window.window_minutes] || `${window.window_minutes} minutes`,
    windowMinutes: Number(window.window_minutes),
    usedPercent,
    remainingPercent,
    resetsAt: Number(window.resets_at || 0) * 1000
  };
}

function normalizeLiveWindow(window) {
  const usedPercent = clamp(Number(window?.used_percent ?? 0), 0, 100);
  const remainingPercent = clamp(100 - usedPercent, 0, 100);
  const windowSeconds = Number(window?.limit_window_seconds || 0);
  const resetAtSeconds = Number(window?.reset_at || 0);
  const resetAfterSeconds = Number(window?.reset_after_seconds || 0);

  return {
    label: WINDOW_NAMES[Math.round(windowSeconds / 60)] || `${Math.round(windowSeconds / 60)} minutes`,
    windowMinutes: Math.round(windowSeconds / 60),
    usedPercent,
    remainingPercent,
    resetsAt: resetAtSeconds > 0 ? resetAtSeconds * 1000 : Date.now() + resetAfterSeconds * 1000
  };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function newer(a, b) {
  return a.capturedAtMs > b.capturedAtMs ? a : b;
}

async function getQuotaSnapshot() {
  if (cache.payload && Date.now() < cache.expiresAt) {
    return cache.payload;
  }

  const live = await getLiveQuotaSnapshot();
  if (live.ok) {
    cache = {
      expiresAt: Date.now() + LIVE_CACHE_MS,
      payload: live
    };
    return live;
  }

  const fallback = await getSessionQuotaSnapshot(live.errors);
  cache = {
    expiresAt: Date.now() + FALLBACK_CACHE_MS,
    payload: fallback
  };

  return fallback;
}

async function getLiveQuotaSnapshot() {
  const generatedAt = new Date().toISOString();

  try {
    const token = await readAccessToken();
    const response = await request(LIVE_USAGE_URL, {
      dispatcher: LIVE_DISPATCHER,
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "user-agent": "CodexQuotaMonitor/1.0"
      },
      headersTimeout: 15_000,
      bodyTimeout: 15_000
    });

    const bodyText = await response.body.text();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`live usage HTTP ${response.statusCode}`);
    }

    const usage = JSON.parse(bodyText);
    const limits = normalizeLiveUsage(usage, generatedAt);
    if (limits.length === 0) {
      throw new Error("live usage response did not include rate limits");
    }

    return {
      ok: true,
      source: "live-api",
      sourceLabel: "Codex 实时使用接口",
      generatedAt,
      limits,
      errors: []
    };
  } catch (error) {
    return {
      ok: false,
      source: "live-api",
      sourceLabel: "Codex 实时使用接口",
      generatedAt,
      limits: [],
      errors: [publicError("live-api", error.message)]
    };
  }
}

async function readAccessToken() {
  const auth = JSON.parse(await readFile(AUTH_FILE, "utf8"));
  const token = auth?.tokens?.access_token;
  if (!token || typeof token !== "string") {
    throw new Error("missing Codex access token; sign in to Codex Desktop first");
  }
  return token;
}

function normalizeLiveUsage(usage, capturedAt) {
  const limits = [];

  if (usage?.rate_limit?.primary_window && usage?.rate_limit?.secondary_window) {
    limits.push({
      capturedAt,
      capturedAtMs: Date.parse(capturedAt),
      limitId: "codex",
      limitName: "Codex",
      meteredFeature: "codex",
      planType: usage.plan_type || null,
      reachedType: usage.rate_limit_reached_type || null,
      allowed: Boolean(usage.rate_limit.allowed),
      limitReached: Boolean(usage.rate_limit.limit_reached),
      primary: normalizeLiveWindow(usage.rate_limit.primary_window),
      secondary: normalizeLiveWindow(usage.rate_limit.secondary_window)
    });
  }

  const additional = Array.isArray(usage?.additional_rate_limits) ? usage.additional_rate_limits : [];
  for (const item of additional) {
    if (!item?.rate_limit?.primary_window || !item?.rate_limit?.secondary_window) {
      continue;
    }

    limits.push({
      capturedAt,
      capturedAtMs: Date.parse(capturedAt),
      limitId: item.metered_feature || item.limit_name || "additional",
      limitName: item.limit_name || item.metered_feature || "Additional",
      meteredFeature: item.metered_feature || null,
      planType: usage.plan_type || null,
      reachedType: null,
      allowed: Boolean(item.rate_limit.allowed),
      limitReached: Boolean(item.rate_limit.limit_reached),
      primary: normalizeLiveWindow(item.rate_limit.primary_window),
      secondary: normalizeLiveWindow(item.rate_limit.secondary_window)
    });
  }

  return limits;
}

async function getSessionQuotaSnapshot(previousErrors = []) {
  const files = await listJsonlFiles(SESSIONS_DIR);
  const byLimit = new Map();
  const errors = [...previousErrors];

  for (const file of files) {
    try {
      const text = await readTail(file.path, file.size);
      const lines = text.trimEnd().split("\n").reverse();

      for (const line of lines) {
        const parsed = parseRateLimitLine(line);
        if (!parsed) {
          continue;
        }

        const current = byLimit.get(parsed.limitId);
        byLimit.set(parsed.limitId, current ? newer(parsed, current) : parsed);
      }
    } catch (error) {
      errors.push(publicError("session-snapshot", error.message));
    }
  }

  const limits = [...byLimit.values()].sort((a, b) => {
    if (a.limitId === "codex") return -1;
    if (b.limitId === "codex") return 1;
    return a.limitId.localeCompare(b.limitId);
  });

  const payload = {
    ok: limits.length > 0,
    source: "session-snapshot",
    sourceLabel: "本地 session 快照兜底",
    generatedAt: new Date().toISOString(),
    limits,
    errors
  };

  return payload;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const requestedPath = path.normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "");
  const filePath = path.resolve(PUBLIC_DIR, requestedPath);

  if (!isInside(PUBLIC_DIR, filePath)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  try {
    const body = await readFile(filePath);
    const ext = path.extname(filePath);
    send(res, 200, body, CONTENT_TYPES[ext] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

function sendJson(res, status, body) {
  send(res, status, JSON.stringify(body, null, 2), "application/json; charset=utf-8");
}

function send(res, status, body, contentType) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function isInside(root, filePath) {
  const relative = path.relative(path.resolve(root), filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function publicError(source, message) {
  return { source, message: sanitizeErrorMessage(message) };
}

function sanitizeErrorMessage(message) {
  return String(message)
    .replaceAll(AUTH_FILE, "<codex-auth>")
    .replaceAll(SESSIONS_DIR, "<codex-sessions>")
    .replaceAll(CODEX_HOME, "<codex-home>");
}

const server = createServer(async (req, res) => {
  try {
    if (req.url?.startsWith("/api/quota")) {
      sendJson(res, 200, await getQuotaSnapshot());
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
});

function listen(port) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && port < START_PORT + 20) {
      listen(port + 1);
      return;
    }
    throw error;
  });

  server.listen(port, HOST, () => {
    console.log(`${APP_NAME}: http://${HOST}:${port}`);
    console.log(`Live usage endpoint: ${LIVE_USAGE_URL}`);
  });
}

listen(START_PORT);
