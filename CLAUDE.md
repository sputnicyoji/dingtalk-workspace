# CLAUDE.md — dingtalk-workspace-mcp 项目指令

本文件是项目级 agent 指令。优先级高于 `~/.claude/CLAUDE.md`，但不覆盖用户显式请求。

---

## 这是什么项目

**核心目标**：交付一个 **dws-driven 动态全覆盖**的钉钉 MCP server。和现存 5+ 个 DingTalk MCP（手写固定 tool 子集）形成差异化——dws 升级新增能力时，**本项目不改一行代码即自动暴露**。

**适用对象**：任何 MCP host（Claude Desktop / Cursor / Codex / Hermes / 其他）。**host-agnostic 是不可妥协的红线**。

**仓库名遗留**：仓库叫 `Hermes-dingtalk` 是历史命名（早期想做 Hermes 专属扩展）。npm 包名 `@sputnicyoji/dingtalk-workspace-mcp` 才是项目本体。**不改仓库名**，避免破坏 GitHub 链接和 clone URL。

**不是**：
- 不是 DingTalk 官方 SDK 再造
- 不是把 dws 用 Rust/Go/Python 重写一遍
- 不是通用 IM 接入框架（不考虑飞书/Slack/Teams）
- 不是 Hermes 专用集成方案（早期方向，已废弃，相关代码归档在 `legacy/`）

**上游依赖**：
- [dws CLI](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli)（Go，用户本机自装）
- 钉钉官方走 "CLI + MCP 广场" 路径，不会自己出官方 MCP（**这是本项目长期价值的护城河**）

---

## 目录约定

```
Hermes-dingtalk/
├── CLAUDE.md                 # 本文件
├── docs/
│   ├── ARCHITECTURE.md       # 架构 + 设计决策
│   ├── ROADMAP.md            # 版本节奏
│   ├── COMPARISON.md         # vs 其他 DingTalk MCP 对比
│   ├── HERMES_INTEGRATION.md # 已归档：legacy/ 调研依据
│   └── decisions/            # ADR
├── packages/
│   └── dingtalk-workspace-mcp/   # 唯一活跃 package
│       ├── src/
│       ├── dist/                 # tsc 输出，不进 git
│       ├── package.json
│       └── README.md
├── legacy/                   # 已归档代码（不再迭代）
│   └── hermes-extensions/    # 早期 Hermes 专属扩展（v0.2 milestone 封档）
├── ref-git/                  # 参考仓库（dws 等），.gitignore 排除
└── LICENSE
```

**禁止**：
- 在 `packages/dingtalk-workspace-mcp/` 中写任何业务逻辑（身份解析、报告模板、告警规则）
- 主包反向依赖 `legacy/`
- 给 `legacy/` 加新代码或新模块（只接受 bug 修复）
- 任何形式的 host 假设（"如果是 Hermes 就……"）

---

## 技术栈约束

| 模块 | 语言/运行时 | 理由 |
|------|-----------|------|
| dingtalk-workspace-mcp | TypeScript + Node.js ≥20 | 对齐 `npx -y` 发行约定，MCP SDK 最成熟 |
| legacy/hermes-extensions | Python（冻结） | 历史选型，保留原状不动 |

**不用**：
- Rust（性能优势用不上，发行方式和 `npx` 生态冲突）
- Go（除非 schema 解析硬瓶颈才考虑重写）

---

## 编码风格

### TypeScript（主包）

- `strict: true`，不开 `any` 逃生舱
- 不写 class，纯函数 + 闭包状态
- 不引入 `execa`/`cross-spawn`，用 Node 原生 `child_process`
- 错误用 `Result<T, E>` 风格（`{ ok: true, value } | { ok: false, error }`），不滥用 throw
- 所有和 dws 的交互走 `src/dispatch.ts` 唯一入口

### 通用

- **注释**：只解释 Why，不解释 What
- **测试**：Vitest，集成测试打在 dws dry-run 模式

---

## Commit 约定

- 格式：Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:`）
- 中文 message OK，但 type 前缀英文
- 不提交 `dist/`、`node_modules/`、`__pycache__/`
- `ref-git/` 在 `.gitignore`

---

## AI Agent 工作规则

1. **写代码前先读** `docs/ARCHITECTURE.md`——所有跨模块影响必须对齐文档，不对齐先改文档
2. **修改主包时**：先跑 `dws schema --format json` 看最新 schema，再动代码
3. **主包不得引入业务逻辑**——任何 if/else 涉及"哪个产品""哪个场景"都是 smell
4. **不得引入 host 假设**——任何代码路径里出现 "if Hermes" / "if Claude Desktop" 都是 red flag
5. **测试**：修主包 → 至少跑一遍 `aitable.query_records`（参数最复杂的 tool），验证序列化
6. **`legacy/` 是只读区**——除非用户明确要求修复，不动其中任何文件
7. **文档优先级**：`docs/ARCHITECTURE.md` > `docs/ROADMAP.md` > `docs/COMPARISON.md` > README > 代码注释

---

## 快速索引

- 架构细节：`docs/ARCHITECTURE.md`
- 版本节奏：`docs/ROADMAP.md`
- 差异化对比：`docs/COMPARISON.md`
- 参考实现：`ref-git/dingtalk-workspace-cli/`
- 历史归档：`legacy/`（封档于 git tag `milestone-v0.2`）

---

## 超出范围的请求

遇到以下请求，**先反问用户再动手**：

- "把 dws 功能重写进主包" → 违反无状态原则
- "给主包加认证" → token 管理归 dws
- "支持飞书/Slack" → 项目范围外
- "用 Rust 重写" → 已在架构阶段拒绝
- "主包加点 Hermes / Claude Desktop / 任何 host 专用优化" → 破坏 host-agnostic 原则
- "再开一个 ext 做 X" → legacy 已封档，不再扩展。新需求走 prompt 模板或独立项目
