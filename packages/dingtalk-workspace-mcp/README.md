# @sputnicyoji/dingtalk-workspace-mcp

> dws-driven, dynamic, full-coverage DingTalk MCP server. Host-agnostic. Auto-syncs with `dws` upgrades — zero maintenance.

## What it does

Spawns the [dws CLI](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli) under the hood, walks its `--help` tree (or `dws schema --format json` when authenticated), and exposes every dws leaf command as a fully-typed MCP tool named `dingtalk.<service>.<...>.<action>`.

When dws ships new products / commands, restart this MCP server and they appear. **No code changes here.**

## Install

You don't install this package directly — it's invoked via `npx -y` from your MCP host config.

**Prerequisites** (all hosts):

```bash
# 1. Install dws (one-time)
# macOS / Linux:
curl -fsSL https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/main/scripts/install.sh | sh
# Windows (PowerShell):
irm https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/main/scripts/install.ps1 | iex

# 2. Authenticate
dws auth login
```

## Wire into your MCP host

`mcp.json` (or your host's equivalent — Claude Desktop, Cursor, Codex, ...):

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

YAML-config hosts use the same shape under their own key:

```yaml
mcp_servers:
  dingtalk:
    command: "npx"
    args: ["-y", "@sputnicyoji/dingtalk-workspace-mcp"]
    timeout: 180
```

That's it. Restart the host. ~80 `dingtalk.*` tools become available.

## CLI flags

```
-v, --verbose         enable verbose logging to stderr
    --timeout <sec>   per-tool-call timeout (default 120, env DINGTALK_MCP_TIMEOUT)
    --version         print version
-h, --help            show help
```

## Behavior summary

| Situation | What happens |
|-----------|--------------|
| `dws` not in `PATH` | server exits 1 with install link |
| `dws` version < 1.0.7 | server exits 1, prompts `dws upgrade` |
| `dws` not authenticated | server starts, exposes 80+ tools (parsed from `--help`) + a `dingtalk.bootstrap` diagnostic tool |
| `dws` authenticated | server starts, prefers richer `dws schema` JSON when available |
| dws schema upgrade breaks parser | help-tree fallback keeps the server alive |
| Single tool call exceeds timeout | returns `{isError: true, code: TIMEOUT}` — no auto-retry |
| dws auth expires mid-session | returns `{isError: true, code: AUTH_EXPIRED}` with retry guidance |

## Architecture

```
MCP host  ──stdio──>  this MCP server  ──spawn──>  dws  ──HTTPS──>  DingTalk Open Platform
```

Server is **stateless**. All token / auth / business logic lives in `dws` itself.

## Develop

```bash
npm install
npm run typecheck
npm test               # 80 vitest tests, ~90% coverage
npm run test:coverage  # full coverage report
npm run build          # tsc → dist/
node smoke-test.mjs    # end-to-end: spawn server, send tools/list (real dws required)
```

## License

MIT © Yoji
