# dingtalk-workspace-mcp

> A dws-driven, dynamically full-coverage DingTalk MCP server for any MCP host.
> 一个 dws-driven、动态全覆盖的钉钉 MCP server，对所有 MCP host 通用。

[English](#english) · [简体中文](#简体中文) · [Roadmap](docs/ROADMAP.md) · [Comparison](docs/COMPARISON.md)

---

## English

### One-line differentiation

Not another hand-written DingTalk MCP that fixes a 20-tool subset. On startup the server walks the [dingtalk-workspace-cli (dws)](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli) `--help` tree and translates the **entire product surface** into MCP tools. When dws ships a new product or capability, restart the server — **zero code change required**.

| Dimension | Existing DingTalk MCPs (5+) | This project |
|-----------|----------------------------|--------------|
| Coverage | Hand-written subset | Auto-syncs full dws surface |
| Response to dws upgrades | Maintainer adds tools manually | Restart and you're done |
| Business logic | Often baked into tools | Pure protocol adaptation, zero assumptions |
| Auth | Each implements its own | Fully delegated to dws (officially maintained) |
| Hosts validated | Usually only the author's | Claude Desktop / Cursor / Codex / any MCP host |

**Moat**: DingTalk officially commits to a "CLI + MCP marketplace" path and will not ship a first-party MCP server. This project's positioning is not at risk of being absorbed by an official offering.

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
- **Stateless** — each tool call spawns dws fresh; no business state held in-process
- **Zero business assumptions** — no product-specific parsers, no embedded report templates, no alert rules
- **Zero host assumptions** — no host-specific branches anywhere in the code path

Identity, permissions, and tokens are entirely owned by dws. This project is purely a `CLI ↔ MCP` protocol adapter.

### Status

**Published**: `@sputnicyoji/dingtalk-workspace-mcp@0.0.4` on npm.

| Progress | Artifact |
|----------|----------|
| ✅ Architecture frozen | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| ✅ Versioning rhythm | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| ✅ Parameter serialization verified | [`docs/decisions/001-param-serialization.md`](docs/decisions/001-param-serialization.md) |
| ✅ Main package implemented and published | [`packages/dingtalk-workspace-mcp/`](packages/dingtalk-workspace-mcp/) |
| ✅ Comparison vs alternatives | [`docs/COMPARISON.md`](docs/COMPARISON.md) |
| 🟡 v0.1 wrap-up | 1-week stability soak + milestone tag |

### Prerequisites

| Dependency | Purpose |
|------------|---------|
| [dws CLI](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli) | DingTalk's official agent-native CLI; must be on PATH |
| Node.js ≥ 20 | Runtime |
| `dws auth login` completed | Reuses dws's auth & token management |

### Install

Any MCP host (`mcp.json` or equivalent):

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

No tokens. No environment variables. No secrets to configure. Everything is delegated to dws.

### Out of scope

- Rewriting dws (Go version is officially maintained — don't reinvent the wheel)
- Other IM platforms (Feishu / Slack / Teams / WeChat are out of scope)
- Business logic in the main package (report templates, identity resolution, alert rules — none of it)
- Host-specific optimizations of any kind (would break host-agnostic guarantees)
- Token management (entirely delegated to dws)

### Documentation

- [`CLAUDE.md`](CLAUDE.md) — agent working instructions and project constraints
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — authoritative architecture and design decisions
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — version cadence
- [`docs/COMPARISON.md`](docs/COMPARISON.md) — differentiation vs alternative implementations

---

## 简体中文

### 一句话差异化

不是再写一个手写固定 tool 子集的 DingTalk MCP。本项目启动时遍历 [`dws --help`](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli) 树，把钉钉**整棵产品树**动态翻译成 MCP tools——dws 升级新增能力，重启一次 MCP server 即生效，**零代码维护**。

| 维度 | 现存 DingTalk MCP（5+ 个） | 本项目 |
|------|----------------------------|--------|
| 覆盖范围 | 手写固定子集 | dws 全产品自动同步 |
| dws 升级响应 | 维护者手动补 tool | 重启即见，零改动 |
| 业务逻辑 | 常混在 tool 里 | 纯协议适配，零业务假设 |
| 认证管理 | 各自实现 | 完全复用 dws（官方维护） |
| 适用 host | 通常只验证过自家 | Claude Desktop / Cursor / Codex / 任意 MCP host |

**护城河**：钉钉官方明确走「CLI + MCP 广场」路径，不会出官方 MCP server。本项目的定位长期不会被官方覆盖归零。

### 架构

```
任意 MCP host (Claude Desktop / Cursor / Codex / ...)
        │
        │ MCP tools/call (stdio JSON-RPC)
        ▼
packages/dingtalk-workspace-mcp/
    无状态  ·  动态 schema  ·  host-agnostic
        │
        │ child_process.spawn
        ▼
    dws binary （用户本机自装，在 PATH）
        │
        │ HTTPS
        ▼
    钉钉开放平台
```

**不变量**：
- **无状态**：每次 tool call 独立 spawn dws，进程内不持久化任何业务数据
- **零业务假设**：不解析"哪个产品"、不内嵌报告模板、不做告警规则
- **零 host 假设**：代码路径里不出现 `if <某个 host>` 分支

身份 / 权限 / token 全部由 dws 承担，本项目只做 `CLI ↔ MCP` 的无状态翻译。

### 状态

**已发布**：`@sputnicyoji/dingtalk-workspace-mcp@0.0.4`（npm）

| 进度 | 产物 |
|------|------|
| ✅ 架构方案冻结 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| ✅ 版本节奏确定 | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| ✅ 参数序列化实测 | [`docs/decisions/001-param-serialization.md`](docs/decisions/001-param-serialization.md) |
| ✅ 主包实现并发布 | [`packages/dingtalk-workspace-mcp/`](packages/dingtalk-workspace-mcp/) |
| ✅ 差异化对比文档 | [`docs/COMPARISON.md`](docs/COMPARISON.md) |
| 🟡 v0.1 收尾事项 | 1 周稳定性观察与 milestone tag |

### 前置依赖

| 依赖 | 用途 |
|------|------|
| [dws CLI](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli) | 钉钉官方 agent-native CLI，须在 PATH |
| Node.js ≥ 20 | 运行时 |
| `dws auth login` 已完成 | 复用 dws 的认证 & token 管理 |

### 接入示例

任意 MCP host（`mcp.json` 或等价配置）：

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

无需配置 token、无需任何密钥环境变量——全部委托 dws。

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

## License

MIT © Yoji
