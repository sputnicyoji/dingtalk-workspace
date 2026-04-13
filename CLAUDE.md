# CLAUDE.md — Hermes-DingTalk 项目指令

本文件是项目级 agent 指令。优先级高于 `~/.claude/CLAUDE.md`，但不覆盖用户显式请求。

---

## 这是什么项目

**核心目标（T1）**：交付一个 **dws-driven 动态全覆盖**的钉钉 MCP server。和现存的 5+ 个 DingTalk MCP server（手写固定 tool 子集）形成差异化——dws 升级新增能力时，**本项目不改一行代码即自动暴露**。任何 MCP host（Claude Desktop、Cursor、Codex、Hermes 等）都能用。

**加分目标（T2）**：在 T1 之上，做一组 **Hermes 专属扩展**，只做"离开 Hermes 独有能力就做不出"的场景（跨周期状态告警、长会议/文档处理）。和 T1 解耦，单独发包，按需迭代。

**不是**：
- 不是 DingTalk 官方 SDK 再造
- 不是把 dws 用 Rust/Go/Python 重写一遍
- 不是通用 IM 接入框架（不考虑飞书/Slack/Teams）
- **不是 Hermes-only 集成方案**（这是仓库名误导，T1 必须保持 host-agnostic）

**上游依赖**：
- [dws CLI](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli)（Go，用户本机自装）
- 钉钉官方走 "CLI + MCP 广场" 路径，不会自己出官方 MCP（**这是本项目长期价值的护城河**）
- [Hermes Agent](https://github.com/nousresearch/hermes-agent)（Python，T2 加分模块的目标 host）

---

## T1 / T2 双轨结构（权威定义在 `docs/ARCHITECTURE.md`）

```
T2: hermes-extensions/   (v0.2+, 选做, 单独发包)
    ├─ ext-stateful-watch     # 跨周期状态告警（Hermes cron 做不到的）
    ├─ ext-long-content       # delegate 处理长会议/文档
    └─ ext-cron-templates     # 纯 prompt 模板，零代码
                ↓ MCP tools/call
T1: packages/dingtalk-workspace-mcp/   (v0, 核心)
    无状态、动态 schema、所有 MCP host 通用
                ↓ child_process.spawn
            dws binary (用户本机自装, 在 PATH)
```

**T2 准入门槛（硬性）**：必须满足 **"离开 Hermes 独有能力就做不出"**。否则砍掉，让用户用 T1 + Hermes 原生功能组合解决。

**Hermes 原生已覆盖、T2 不重做**：
- 钉钉 messaging adapter（Stream Mode 收发消息）→ Hermes v0.4.0 已有
- cron 定时任务 + `deliver="dingtalk"` → Hermes 原生
- MCP 消费 → Hermes 原生

---

## 目录约定

```
Hermes-dingtalk/
├── CLAUDE.md                 # 本文件
├── docs/
│   ├── ARCHITECTURE.md       # T1/T2 架构 + 设计决策
│   ├── ROADMAP.md            # 版本节奏 v0 → v1.0+
│   ├── COMPARISON.md         # vs 其他 DingTalk MCP 对比（v0.1 必交付）
│   └── decisions/            # ADR 风格决策记录
├── packages/
│   └── dingtalk-workspace-mcp/   # T1：v0 主交付
│       ├── src/
│       ├── dist/                 # tsc 输出，不进 git
│       ├── package.json
│       └── README.md
├── hermes-extensions/        # T2：v0.2+ 起按需添加
│   ├── ext-cron-templates/   # v0.1 附带（纯模板，无代码）
│   ├── ext-stateful-watch/   # v0.2
│   └── ext-long-content/     # v0.3
├── ref-git/                  # 参考仓库（dws、Hermes），.gitignore 排除
└── LICENSE
```

**禁止**：
- 在 `packages/dingtalk-workspace-mcp/` 中写任何业务逻辑（身份解析、报告模板、告警规则）——这些归 T2
- T1 反向依赖 T2
- T2 各 ext 之间互相依赖（保持每个 ext 独立可发布、可卸载）

---

## 技术栈约束

| 模块 | 语言/运行时 | 理由 |
|------|-----------|------|
| T1 dingtalk-workspace-mcp | TypeScript + Node.js ≥20 | 对齐 `npx -y` 发行约定，MCP SDK 最成熟 |
| T2 ext-stateful-watch | Python（复用 Hermes runtime） | 作为 Hermes cron job / plugin 运行 |
| T2 ext-long-content | Python（同上） | 需要调 Hermes delegate_tool / trajectory_compressor |
| T2 ext-cron-templates | 纯 markdown + yaml | 零代码，prompt 模板 + 安装脚本 |

**不用**：
- Rust（性能优势用不上，发行方式和 `npx` 生态冲突）
- Go（除非 T1 schema 解析硬瓶颈才考虑重写）

---

## 编码风格

### TypeScript (T1)

- `strict: true`，不开 `any` 逃生舱
- 不写 class，纯函数 + 闭包状态
- 不引入 `execa`/`cross-spawn`，用 Node 原生 `child_process`
- 错误用 `Result<T, E>` 风格（`{ ok: true, value } | { ok: false, error }`），不滥用 throw
- 所有和 dws 的交互走 `src/dispatch.ts` 唯一入口

### Python (T2)

- Python ≥3.11（Hermes 基线）
- 类型注解强制，`from __future__ import annotations`
- 禁止裸 `except:`，最窄 except + 日志
- 状态文件只写 JSONL，不引入 SQLite（除非数据量超 10k 行）

### 通用

- **注释**：只解释 Why，不解释 What
- **测试**：T1 用 Vitest，T2 用 pytest；集成测试都打在 dws dry-run 模式

---

## Commit 约定

- 格式：Conventional Commits（`feat(t1):` / `fix(ext-watch):` / `docs:` / `chore:`）
- 中文 message OK，但 type 前缀英文
- 不提交 `dist/`、`node_modules/`、`__pycache__/`、`.hermes/`
- `ref-git/` 在 `.gitignore`

---

## AI Agent 工作规则

1. **写代码前先读** `docs/ARCHITECTURE.md`——所有跨模块影响必须对齐文档，不对齐先改文档
2. **T1 修改时**：先跑 `dws schema --format json` 看最新 schema，再动代码
3. **T2 新增 ext 前**：自检"离开 Hermes 独家能力是否做不出"——能做出来就别加 ext，写文档教用户用 T1+Hermes 原生功能组合
4. **T1 修改不得引入业务逻辑**——任何 if/else 涉及"哪个产品""哪个场景"都是 smell
5. **测试**：修 T1 → 至少跑一遍 `aitable.query_records`（参数最复杂的 tool），验证序列化
6. **文档优先级**：`docs/ARCHITECTURE.md` > `docs/ROADMAP.md` > `docs/COMPARISON.md` > README > 代码注释

---

## 快速索引

- 架构细节：`docs/ARCHITECTURE.md`
- 版本节奏：`docs/ROADMAP.md`
- 差异化对比：`docs/COMPARISON.md`（v0.1 交付）
- 参考实现：`ref-git/dingtalk-workspace-cli/`
- 上游 agent：`D:\Hermes_Agent\`

---

## 超出范围的请求

遇到以下请求，**先反问用户再动手**：

- "把 dws 功能重写进 T1" → 违反 T1 无状态原则
- "给 T1 加认证" → token 管理归 dws
- "支持飞书/Slack" → 项目范围外
- "用 Rust 重写" → 已在架构阶段拒绝
- "T1 加点 Hermes 专用优化" → 破坏 T1 host-agnostic 原则，应放进 T2 ext
- "再加一个 ext 做 X" → 先过"Hermes 独家能力"准入门槛
