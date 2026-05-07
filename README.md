# Codex Usage Lens

**中文** | [English](./README.en.md)

Codex Usage Lens 是一个本地运行、注重隐私的 Codex Desktop 额度看板，用来查看 5 小时和 1 周使用窗口的当前剩余额度。

> 非官方社区工具，与 OpenAI 官方无隶属关系。

![Codex Usage Lens 截图](assets/screenshot.png)

## 功能特性

- 读取 Codex Desktop 同源使用量接口：`https://chatgpt.com/backend-api/wham/usage`
- 展示 5 小时和 1 周窗口的剩余百分比、已用百分比、重置倒计时和重置时间
- 页面每 5 秒刷新一次
- 监听额度只是查询使用量 API，不触发模型推理，不消耗 Codex token 或对话额度，可以放心使用
- 默认只监听 `127.0.0.1`
- 访问令牌只在本地 Node 服务端读取，不会返回给浏览器
- 实时接口不可用时，自动退回读取本地 `~/.codex/sessions` 里的 `rate_limits` 快照

## 环境要求

- Node.js 20+
- 同一台机器上已登录 Codex Desktop
- Codex Desktop 已生成有效的 `~/.codex/auth.json`

## 快速开始

```bash
npm install
npm start
```

打开：

```text
http://127.0.0.1:8787
```

## 配置项

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP 监听地址。除非明确知道风险，否则建议保持本地监听。 |
| `PORT` | `8787` | 首选端口。如果被占用，服务会尝试后续端口。 |
| `CODEX_HOME` | `~/.codex` | Codex 配置目录。 |
| `CODEX_USAGE_URL` | `https://chatgpt.com/backend-api/wham/usage` | Codex 使用量接口。 |
| `HTTPS_PROXY` / `HTTP_PROXY` | 未设置 | 服务端请求使用量接口时使用的可选代理。 |
| `LIVE_CACHE_MS` | `4000` | 实时接口成功读取后的缓存时间。 |
| `FALLBACK_CACHE_MS` | `1500` | 本地快照兜底数据的缓存时间。 |

## 数据来源

优先读取实时接口：

```text
GET https://chatgpt.com/backend-api/wham/usage
Authorization: Bearer <tokens.access_token from ~/.codex/auth.json>
```

使用字段：

- `rate_limit.primary_window`：5 小时窗口
- `rate_limit.secondary_window`：1 周窗口
- `used_percent`：已用百分比
- `reset_at`：重置时间戳

兜底读取本地快照：

```text
~/.codex/sessions/**/*.jsonl
```

本地快照来自 Codex 写入 session 日志的 `rate_limits` 事件，可能滞后于实时接口。因此当页面使用兜底数据时，会明确标记为“本地快照”。

## 隐私说明

浏览器只请求本机 `/api/quota`。本地 Node 服务端读取 `~/.codex/auth.json` 并在服务端调用使用量接口，访问令牌不会返回给浏览器。

额度监听只调用使用量查询 API，不会发起 Codex 对话或模型推理请求，因此不会消耗 token 或对话额度。

`/api/quota` 也不会返回本机文件路径、auth 文件路径或 session 文件路径。

## 常用命令

```bash
npm run check
npm start
```

## macOS 常驻运行

如果不想因为终端关闭导致页面断连，可以安装用户级 LaunchAgent：

```bash
npm run service:install
```

卸载：

```bash
npm run service:uninstall
```

## 许可证

MIT
