# dingtalk-workspace-mcp

> **dws-driven 动态全覆盖的钉钉 MCP server**，对所有 MCP host 通用——Claude Desktop / Cursor / Codex / Hermes / 其他都能直接用。

**仓库名 `Hermes-dingtalk` 是历史命名**（早期想做 Hermes 专属扩展，后来废弃）。npm 包名 `@sputnicyoji/dingtalk-workspace-mcp` 才是项目本体；早期 Hermes 扩展代码已归档在 [`legacy/`](legacy/)，封档点 git tag `milestone-v0.2`。

**进度与差异化**：[`docs/ROADMAP.md`](docs/ROADMAP.md) · [`docs/COMPARISON.md`](docs/COMPARISON.md)

---

## 一句话差异化

不是再写一个手写固定 tool 子集的 DingTalk MCP。本项目启动时遍历 `dws --help` 树，把 [dingtalk-workspace-cli (dws)](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli) 的**整棵产品树**动态翻译成 MCP tools——dws 升级新增能力，重启一次 MCP server 即生效，**零代码维护**。

| 维度 | 现存 DingTalk MCP（5+ 个） | 本项目 |
|------|----------------------------|--------|
| 覆盖范围 | 手写固定子集 | dws 全产品自动同步 |
| dws 升级响应 | 维护者手动补 tool | 重启即见，零改动 |
| 业务逻辑 | 常混在 tool 里 | 纯协议适配，零业务假设 |
| 认证管理 | 各自实现 | 完全复用 dws（官方维护） |
| 适用 host | 通常只验证过自家 | Claude Desktop / Cursor / Codex / Hermes / ... |

**护城河**：钉钉官方明确走「CLI + MCP 广场」路径，不会出官方 MCP server。本项目的定位长期不会被官方覆盖归零。

---

## 架构

```
任意 MCP host (Claude Desktop / Cursor / Codex / Hermes / ...)
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
- **零 host 假设**：代码路径里没有 "if Hermes" / "if Claude Desktop"

身份 / 权限 / token 全部由 dws 承担，本项目只做 "CLI protocol ↔ MCP protocol" 的无状态翻译。

---

## 状态

**已发布**：`@sputnicyoji/dingtalk-workspace-mcp@0.0.4`（npm）

| 进度 | 产物 |
|------|------|
| ✅ 架构方案冻结 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| ✅ 版本节奏确定 | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| ✅ 参数序列化实测 | [`docs/decisions/001-param-serialization.md`](docs/decisions/001-param-serialization.md) |
| ✅ 主包实现并发布 | [`packages/dingtalk-workspace-mcp/`](packages/dingtalk-workspace-mcp/) |
| ✅ 差异化对比文档 | [`docs/COMPARISON.md`](docs/COMPARISON.md) |
| 🟡 v0.1 收尾事项 | README 首屏链接、1 周稳定性观察与 milestone tag |

---

## 前置依赖

| 依赖 | 用途 |
|------|------|
| [dws CLI](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli) | 钉钉官方 agent-native CLI，须在 PATH |
| Node.js ≥ 20 | 运行时 |
| `dws auth login` 已完成 | 复用 dws 的认证 & token 管理 |

---

## 接入示例

Claude Desktop / Cursor / Codex（`mcp.json` / 等价配置）：

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

Hermes Agent：

```yaml
mcp_servers:
  dingtalk:
    command: "npx"
    args: ["-y", "@sputnicyoji/dingtalk-workspace-mcp"]
    timeout: 180
```

无需配置 token、无需任何密钥环境变量——全部委托 dws。

---

## 不做什么

- 重写 dws（Go 版官方维护，不重造轮子）
- 扩展到飞书 / Slack / Teams（单仓单平台，保持聚焦）
- 在主包放业务逻辑（报告模板、身份解析、告警规则）
- 任何形式的 host 专用优化（破坏 host-agnostic 原则）
- 自己管 token（全部委托 dws）
- 给 `legacy/` 加新代码（已封档，不再迭代）

---

## `legacy/` 是什么

早期项目计划做"T1 通用 MCP server + T2 Hermes 专属扩展"双轨。T2 部分（`hermes-extensions/ext-stateful-watch` + `ext-cron-templates`）在 v0.2 milestone 完成 MVP 后被战略性砍掉——继续维护跨 host 通用性比绑定单一 host 更重要。

代码原样保留在 [`legacy/hermes-extensions/`](legacy/hermes-extensions/) 作为参考实现。封档点：git tag `milestone-v0.2`。不再迭代、不再发包、不在路线图中。

---

## 文档索引

- [`CLAUDE.md`](CLAUDE.md) — agent 工作指令与项目约束
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 权威架构与设计决策
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — 版本节奏
- [`docs/COMPARISON.md`](docs/COMPARISON.md) — 差异化对比
- [`docs/HERMES_INTEGRATION.md`](docs/HERMES_INTEGRATION.md) — 已归档：legacy 调研依据

---

## License

MIT © Yoji
