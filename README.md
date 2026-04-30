# dingtalk-workspace-mcp

> A protocol bridge that turns DingTalk's official `dws` CLI into a host-agnostic MCP server.
> 把钉钉官方 `dws` CLI 转成任意 MCP host 可用的通用 MCP server。

[![npm version](https://img.shields.io/npm/v/@sputnicyoji/dingtalk-workspace-mcp.svg)](https://www.npmjs.com/package/@sputnicyoji/dingtalk-workspace-mcp)
[![node](https://img.shields.io/node/v/@sputnicyoji/dingtalk-workspace-mcp.svg)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/@sputnicyoji/dingtalk-workspace-mcp.svg)](LICENSE)

[English](#english) · [简体中文](#简体中文) · [Roadmap](docs/ROADMAP.md) · [Comparison](docs/COMPARISON.md)

---

## 📦 Install — npm package `@sputnicyoji/dingtalk-workspace-mcp`

Add the following block to your MCP host config (`mcp.json` or equivalent — works with Claude Desktop / Cursor / Codex / any MCP host):

```json
{
  "mcpServers": {
    "dingtalk": {
      "command": "npx",
      "args": ["-y", "@sputnicyoji/dingtalk-workspace-mcp"]
    }
  }
}
```

That's the entire install. No `npm install -g`, no clone, no build — `npx` pulls the package on first run. Restart the host and ~80 `dingtalk.*` tools appear automatically.

<details>
<summary>YAML-config hosts (same shape under their own key)</summary>

```yaml
mcp_servers:
  dingtalk:
    command: "npx"
    args: ["-y", "@sputnicyoji/dingtalk-workspace-mcp"]
    timeout: 180
```

</details>

> [!TIP]
> Pin a version in production: `"@sputnicyoji/dingtalk-workspace-mcp@0.0.5"`.

> [!NOTE]
> No tokens, no env vars, no secrets in the host config. Identity, permissions and token refresh are entirely delegated to the `dws` CLI — see [Prerequisites](#prerequisites) below.

### Prerequisites

The MCP server is a thin protocol adapter; the heavy lifting happens in `dws`, which you install **once on your machine**:

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/main/scripts/install.sh | sh

# Windows (PowerShell)
irm https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/main/scripts/install.ps1 | iex

# then authenticate (one-time browser OAuth)
dws auth login
```

| Dependency | Purpose |
|------------|---------|
| [`dws` CLI](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli) ≥ 1.0.7 | Official DingTalk capability engine, must be on `PATH` |
| Node.js ≥ 20 | Runtime for the MCP server (auto-pulled by `npx`) |
| `dws auth login` completed | Reuses dws auth & token management |

### CLI flags

```
-v, --verbose         enable verbose logging to stderr
    --timeout <sec>   per-tool-call timeout (default 120, env DINGTALK_MCP_TIMEOUT)
    --version         print version
-h, --help            show help
```

---

## English

### Why this exists

DingTalk already ships [`dws`](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli) as the official capability engine. This project does not replace it. On startup it walks the `dws --help` tree (or `dws schema --format json` when authenticated) and translates the **entire dws command surface** into MCP tools. When dws ships a new product or capability, restart the server — **zero code change required**.

Direct `dws ...` calls work for terminals and scripts. MCP hosts need something different: tool discovery, structured arguments, standard errors, permission boundaries, and a way to avoid handing arbitrary shell access to an LLM. This server provides exactly that layer — and nothing more.

### One-line differentiation

| Dimension | `dws` CLI | This project |
|-----------|-----------|--------------|
| Role | Official DingTalk capability engine | MCP protocol adapter for `dws` |
| Interface | Terminal commands and JSON stdout | MCP `tools/list` + `tools/call` |
| Consumers | Humans, scripts, CLI-compatible agents | Claude Desktop / Cursor / Codex / any MCP host |
| Auth | OAuth, token storage, permissions, audit | Fully delegated to `dws` |
| Coverage | Full official `dws` product surface | Auto-syncs the discovered surface |
| Upgrade path | `dws` adds commands | Restart and expose them through MCP |
| Business logic | Official product behavior | Pure protocol adaptation, zero assumptions |

**Moat**: DingTalk's strategy is the official `dws` CLI plus a broader MCP ecosystem, not a single first-party MCP server that replaces third-party adapters. This project stays ecosystem-neutral: one dws-driven adapter, any MCP host, no host-specific glue code.

### Architecture

```
Any MCP host (Claude Desktop / Cursor / Codex / ...)
        │
        │ MCP tools/call (stdio JSON-RPC)
        ▼
packages/dingtalk-workspace-mcp/
    stateless  ·  dynamic schema  ·  host-agnostic
        │
        │ child_process.spawn
        ▼
    dws binary (user-installed, on PATH)
        │
        │ HTTPS
        ▼
    DingTalk Open Platform
```

**Invariants**:

- **Stateless** — each tool call spawns `dws` fresh; no business state held in-process
- **Zero business assumptions** — no product-specific parsers, no embedded report templates, no alert rules
- **Zero host assumptions** — no host-specific branches anywhere in the code path

### Behavior summary

| Situation | What happens |
|-----------|--------------|
| `dws` not in `PATH` | server exits 1 with install link |
| `dws` version < 1.0.7 | server exits 1, prompts `dws upgrade` |
| `dws` not authenticated | server starts with 80+ tools (parsed from `--help`) plus a `dingtalk.bootstrap` diagnostic tool |
| `dws` authenticated | server prefers richer `dws schema` JSON when available |
| dws schema upgrade breaks parser | help-tree fallback keeps the server alive |
| Single tool call exceeds timeout | returns `{isError: true, code: TIMEOUT}` — no auto-retry |
| dws auth expires mid-session | returns `{isError: true, code: AUTH_EXPIRED}` with retry guidance |

### Status

**Published**: [`@sputnicyoji/dingtalk-workspace-mcp@0.0.5`](https://www.npmjs.com/package/@sputnicyoji/dingtalk-workspace-mcp)

| Progress | Artifact |
|----------|----------|
| Architecture frozen | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Versioning rhythm | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| Parameter serialization verified | [`docs/decisions/001-param-serialization.md`](docs/decisions/001-param-serialization.md) |
| Main package implemented and published | [`packages/dingtalk-workspace-mcp/`](packages/dingtalk-workspace-mcp/) |
| Comparison vs alternatives | [`docs/COMPARISON.md`](docs/COMPARISON.md) |
| v0.1 wrap-up | 1-week stability soak + milestone tag |

### Out of scope

- Rewriting `dws` (the Go version is officially maintained — don't reinvent the wheel)
- Other IM platforms (Feishu / Slack / Teams / WeChat)
- Business logic in the main package (report templates, identity resolution, alert rules)
- Host-specific optimizations of any kind (would break host-agnostic guarantees)
- Token management (entirely delegated to `dws`)

### Documentation

- [`CLAUDE.md`](CLAUDE.md) — agent working instructions and project constraints
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — authoritative architecture and design decisions
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — version cadence
- [`docs/COMPARISON.md`](docs/COMPARISON.md) — differentiation vs alternative implementations

---

## 简体中文

### 为什么需要这一层

钉钉已经有官方能力底座 [`dws`](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli)。本项目不替代 dws，只把 dws 转成通用 MCP server：启动时遍历 `dws --help` 树（已认证时优先 `dws schema --format json`），把 **dws 整个命令面**动态翻译成 MCP tools。dws 升级新增能力，重启一次 MCP server 即生效，**零代码维护**。

直接调用 `dws ...` 适合终端和脚本。MCP host 需要的是另一层：工具发现、结构化参数、标准错误、权限边界，以及避免把任意 shell 权限交给 LLM。本项目只提供这层，不接管钉钉身份、权限和业务语义。

### 一句话差异化

| 维度 | `dws` CLI | 本项目 |
|------|-----------|--------|
| 角色 | 钉钉官方能力引擎 | dws 的 MCP 协议适配层 |
| 接口 | 终端命令和 JSON stdout | MCP `tools/list` + `tools/call` |
| 使用者 | 人、脚本、CLI-compatible agents | Claude Desktop / Cursor / Codex / 任意 MCP host |
| 认证管理 | OAuth、token、权限、审计 | 完全委托给 dws |
| 覆盖范围 | 官方 dws 产品能力面 | 自动同步探测到的能力面 |
| dws 升级响应 | dws 新增命令 | 重启后通过 MCP 暴露 |
| 业务逻辑 | 官方产品行为 | 纯协议适配，零业务假设 |

**护城河**：钉钉的策略是官方 dws CLI 加 MCP 生态，而不是用一个官方全覆盖 MCP server 替代第三方适配器。本项目保持生态中立：一个 dws-driven adapter，任意 MCP host 可接，不写 host 专用胶水。

### 架构不变量

- **无状态**：每次 tool call 独立 spawn dws，进程内不持久化任何业务数据
- **零业务假设**：不解析"哪个产品"、不内嵌报告模板、不做告警规则
- **零 host 假设**：代码路径里不出现 `if <某个 host>` 分支

身份 / 权限 / token 全部由 dws 承担，本项目只做 `CLI <-> MCP` 的无状态翻译。

### 不做什么

- 重写 dws（Go 版官方维护，不重造轮子）
- 扩展到飞书 / Slack / Teams / 微信（单仓单平台，保持聚焦）
- 在主包放业务逻辑（报告模板、身份解析、告警规则）
- 任何形式的 host 专用优化（破坏 host-agnostic 原则）
- 自己管 token（全部委托 dws）

### 文档索引

- [`CLAUDE.md`](CLAUDE.md) — agent 工作指令与项目约束
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 权威架构与设计决策
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — 版本节奏
- [`docs/COMPARISON.md`](docs/COMPARISON.md) — 差异化对比

---

MIT © Yoji
