# Codex Usage Lens

A local, privacy-conscious dashboard for Codex Desktop usage limits.

Codex Usage Lens shows the current 5-hour and 1-week Codex usage windows, refreshes every 5 seconds, and keeps your Codex access token on the local server side.

This is an unofficial community tool and is not affiliated with OpenAI.

## Features

- Reads the same usage endpoint used by Codex Desktop: `https://chatgpt.com/backend-api/wham/usage`
- Shows remaining and used percentages for the 5-hour and 1-week windows
- Falls back to local `~/.codex/sessions` rate-limit snapshots when the live endpoint is unavailable
- Serves only on `127.0.0.1` by default
- Does not expose `~/.codex/auth.json` or access tokens to the browser

## Requirements

- Node.js 20+
- Codex Desktop signed in on the same machine
- A valid `~/.codex/auth.json` created by Codex Desktop

## Quick Start

```bash
npm install
npm start
```

Open:

```text
http://127.0.0.1:8787
```

## Configuration

Environment variables:

| Name | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP bind host. Keep this local unless you know what you are doing. |
| `PORT` | `8787` | Preferred port. The server will try the next ports if it is occupied. |
| `CODEX_HOME` | `~/.codex` | Codex config directory. |
| `CODEX_USAGE_URL` | `https://chatgpt.com/backend-api/wham/usage` | Usage endpoint. |
| `HTTPS_PROXY` / `HTTP_PROXY` | unset | Optional proxy used by the server-side usage request. |
| `LIVE_CACHE_MS` | `4000` | Cache duration for successful live usage reads. |
| `FALLBACK_CACHE_MS` | `1500` | Cache duration for local session snapshot fallback. |

## Data Source

Primary source:

```text
GET https://chatgpt.com/backend-api/wham/usage
Authorization: Bearer <tokens.access_token from ~/.codex/auth.json>
```

Fields used:

- `rate_limit.primary_window`: 5-hour window
- `rate_limit.secondary_window`: 1-week window
- `used_percent`: used percentage
- `reset_at`: reset timestamp

Fallback source:

```text
~/.codex/sessions/**/*.jsonl
```

The fallback reads the newest `rate_limits` snapshots emitted into local Codex session logs. These snapshots can be stale, so the UI labels them as local snapshots when the live endpoint cannot be used.

## Privacy

The browser only talks to the local `/api/quota` endpoint. The local Node server reads `~/.codex/auth.json` and calls the usage endpoint server-side. The access token is never returned to the browser API response.

The server API also avoids returning local filesystem paths.

## Scripts

```bash
npm run check
npm start
```

## License

MIT
