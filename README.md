# Hermes-DingTalk

> **dws-driven 动态全覆盖的钉钉 MCP server**，对所有 MCP host 通用；外加一组只为 [Hermes Agent](https://github.com/nousresearch/hermes-agent) 而生的可选扩展。

**仓库名容易误导**：T1 核心是 host-agnostic 的协议适配器，Claude Desktop / Cursor / Codex / Hermes 都能直接用；Hermes 只是 T2 加分包的宿主。

---

## 一句话差异化

不是再写一个手写固定 tool 子集的 DingTalk MCP。T1 启动时执行一次 `dws schema --format json`，把 [dingtalk-workspace-cli (dws)](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli) 的**整棵产品树**动态翻译成 MCP tools——dws 升级新增能力，重启一次 MCP server 即生效，**零代码维护**。

| 维度 | 现存 DingTalk MCP（5+ 个） | 本项目 T1 |
|------|----------------------------|-----------|
| 覆盖范围 | 手写固定子集 | dws 全产品自动同步 |
| dws 升级响应 | 维护者手动补 tool | 重启即见，零改动 |
| 业务逻辑 | 常混在 tool 里 | 纯协议适配，零业务假设 |
| 认证管理 | 各自实现 | 完全复用 dws（官方维护） |
| 适用 host | 通常只验证过自家 | Claude Desktop / Cursor / Codex / Hermes / ... |

**护城河**：钉钉官方明确走「CLI + MCP 广场」路径，不会出官方 MCP server。本项目的定位长期不会被官方覆盖归零。

---

## 架构

```
T2: hermes-extensions/             (v0.2+, 选做, 单独发包)
    ├─ ext-stateful-watch          # 跨周期状态告警
    ├─ ext-long-content            # 长会议/文档 delegate 流水线
    └─ ext-cron-templates          # 日报/周报 prompt 模板（零代码）
                │
                │ 通过标准 MCP tools/call 调 T1
                │ （和任何其他 host 走同一条路径）
                ▼
T1: packages/dingtalk-workspace-mcp/   (v0, 核心)
    无状态  ·  动态 schema  ·  host-agnostic
                │
                │ child_process.spawn
                ▼
            dws binary （用户本机自装，在 PATH）
```

**严格分层**：T1 从不反向依赖 T2；T2 通过标准 MCP 协议调 T1，不走任何特殊接口。

- **T1** = 协议适配器：无状态、host-agnostic、不假设业务。
- **T2** = Hermes 专属增量：只做「离开 Hermes 独家能力（`delegate_tool` / `trajectory_compressor` / cron 状态保持）就做不出」的场景。

---

## 状态

**v0 开发中**。当前：架构冻结，准备启动 T1 实现。

| 进度 | 产物 |
|------|------|
| ✅ 架构方案冻结 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| ✅ 版本节奏确定 | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| ✅ Hermes 集成方案成文 | [`docs/HERMES_INTEGRATION.md`](docs/HERMES_INTEGRATION.md) |
| ✅ T1 参数序列化实测 | [`docs/decisions/001-param-serialization.md`](docs/decisions/001-param-serialization.md) |
| ⏳ `packages/dingtalk-workspace-mcp/` 实现 | — |
| ⏳ 差异化对比稿 | `docs/COMPARISON.md`（v0.1 交付） |

---

## 前置依赖

| 依赖 | 用途 | 谁需要 |
|------|------|--------|
| [dws CLI](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli) | 钉钉官方 agent-native CLI，须在 PATH | 所有人 |
| Node.js ≥ 20 | T1 运行时 | 所有人 |
| `dws auth login` 已完成 | 复用 dws 的认证 & token 管理 | 所有人 |
| Python ≥ 3.11 | T2 扩展运行时 | 仅 T2 用户 |
| [Hermes Agent](https://github.com/nousresearch/hermes-agent) | T2 扩展宿主 | 仅 T2 用户 |

---

## 接入示例（v0 发布后）

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

## 为什么 T2 存在

T1 已经覆盖「让 Agent 读写钉钉」的全部基础能力。T2 只做 Hermes 不可替代的增量：

- **ext-stateful-watch** — Hermes cron 每次执行是独立 context，无跨周期状态。T2 在 `.hermes/state/` 维护 JSONL，实现诸如「连续 3 天未更新 → DING 提醒负责人」这类跨周期规则。
- **ext-long-content** — 长会议纪要 / 周报汇总触达 LLM 上下文上限时，T2 调 Hermes `delegate_tool` + `trajectory_compressor` 切片并行处理再归并。
- **ext-cron-templates** — 纯 markdown + yaml 的日报 / 周报 / 告警模板，零代码，直接喂给 Hermes cron，`deliver="dingtalk"` 输出。

每个 ext 独立可装可卸。不需要 T2？T1 单独工作良好。

---

## 不做什么

- ❌ 重写 dws（Go 版官方维护，不重造轮子）
- ❌ 扩展到飞书 / Slack / Teams（单仓单平台，保持聚焦）
- ❌ 在 T1 放业务逻辑（报告模板、身份解析、告警规则——全部归 T2）
- ❌ 把 T1 做成 Hermes-only（破坏 host-agnostic 原则）
- ❌ 自己管 token（全部委托 dws）

---

## 文档索引

- [`CLAUDE.md`](CLAUDE.md) — agent 工作指令与项目约束
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — T1/T2 权威架构与设计决策
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — v0 → v1.0+ 版本节奏
- [`docs/HERMES_INTEGRATION.md`](docs/HERMES_INTEGRATION.md) — Hermes 集成路径细节

---

## License

MIT © Yoji
