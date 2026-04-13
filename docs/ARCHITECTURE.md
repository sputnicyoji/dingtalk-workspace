# Hermes-DingTalk 架构文档

**版本**：0.2（2026-04-13 重写——基于公开仓库调研重新定位）
**状态**：T1 设计冻结，T2 扩展按需迭代

---

## 1. 项目定位（重写后）

### 1.1 一句话定位

**T1**：一个 dws-driven、动态全覆盖的钉钉 MCP server，所有 MCP host 通用。
**T2**：一组 Hermes 专属扩展，只做 Hermes 独家能力 × 钉钉的真正交集。

### 1.2 为什么是这个定位（基于调研事实）

调研结论（详见 `docs/COMPARISON.md`，v0.1 交付）：

| 已存在 | 不存在 |
|--------|-------|
| dws CLI（钉钉官方，agent-native） | dws-driven 动态 MCP 适配器 |
| 5+ 独立 DingTalk MCP（手写固定子集） | 全产品自动覆盖、随 dws 升级零维护 |
| Hermes 钉钉 messaging adapter (Stream Mode) | 跨周期状态告警（Hermes cron 单次执行做不到） |
| Hermes cron + `deliver="dingtalk"` | 长会议/文档 delegate 流水线（需 Hermes 独家能力） |

**护城河**：钉钉官方走 "CLI + MCP 广场" 路径，明确不出官方 MCP server。本项目长期价值不会被官方覆盖归零。

### 1.3 三个硬指标

1. **T1**：用户接入任何 MCP host 的成本 ≤ 4 行配置
2. **T1**：dws 升级新增产品/能力，wrapper **不改一行代码**自动暴露
3. **T2**：每个 ext 必须证明"离开 Hermes 独家能力做不出"，否则不立项

---

## 2. T1 / T2 双轨结构

```
┌─────────────────────────────────────────────────────────┐
│  T2: hermes-extensions/  (v0.2+, 选做, 单独发包)         │
│  ────────────────────                                    │
│  ext-stateful-watch  → 跨周期状态告警 (B6 精简版)        │
│  ext-long-content    → delegate 处理长会议/文档 (B5)     │
│  ext-cron-templates  → 纯 prompt 模板, 零代码 (替代 B4)  │
└────────────────────┬────────────────────────────────────┘
                     │ 通过 MCP tools/call 调 T1
                     │ (和其他 host 一样, 不走特殊接口)
┌────────────────────▼────────────────────────────────────┐
│  T1: packages/dingtalk-workspace-mcp/  (v0, 核心)        │
│  无状态 MCP server: tools 动态由 dws schema 生成          │
│  进程模型: 长驻 stdio server, 每次 tool call spawn dws    │
│  Host 中立: Claude Desktop / Cursor / Codex / Hermes 通用 │
└────────────────────┬────────────────────────────────────┘
                     │ child_process.spawn('dws', ...)
┌────────────────────▼────────────────────────────────────┐
│  dws binary (用户本机自装, 在 PATH)                       │
│  OAuth device-flow → DingTalk Open Platform HTTPS API    │
└─────────────────────────────────────────────────────────┘
```

**契约**：

| 模块 | 输入 | 输出 | 状态 | host 假设 |
|------|------|------|------|----------|
| T1 | MCP `tools/call` | JSON (dws stdout) | 无 | 任意 MCP host |
| T2 ext-stateful-watch | Hermes cron 触发 + 配置 | 告警推送 | 本地 JSONL | Hermes only |
| T2 ext-long-content | Hermes skill 调用 | 结构化纪要 + 分发结果 | Hermes memory | Hermes only |
| T2 ext-cron-templates | 安装命令 | 用户 ~/.hermes 下的 cron prompt | 无 | Hermes only |

**跨模块约束**：
- T1 **禁止**任何 Hermes 假设（API、依赖、路径）
- T2 各 ext 之间**禁止**互相依赖（独立可发布、可卸载）
- T2 **必须**通过 T1 调 dws，不允许 T2 直接 spawn dws

---

## 3. T1：dingtalk-workspace-mcp 详述

### 3.1 核心思路

**"协议适配器"**——把 `dws CLI` 的 JSON 输出翻译成 MCP 协议。**不做任何业务增强**。任何业务逻辑都属于 T2 或上游 agent prompt。

### 3.2 目录结构

```
packages/dingtalk-workspace-mcp/
├── src/
│   ├── cli.ts              # 入口, shebang, 参数解析
│   ├── server.ts           # MCP server 实例 + 生命周期
│   ├── schema-loader.ts    # 启动时调 `dws schema`, 转 MCP tool 定义
│   ├── dispatch.ts         # tools/call → dws spawn (唯一出口)
│   ├── dws-probe.ts        # dws 存在性 + 版本 + auth 状态检测
│   ├── errors.ts           # Result<T,E> + 错误归一化
│   └── types.ts            # 共享类型
├── tests/
│   ├── schema-loader.test.ts
│   ├── dispatch.test.ts
│   └── fixtures/           # dws schema 输出样本
├── dist/
├── package.json
├── tsconfig.json
└── README.md
```

### 3.3 启动流程

```
1. 解析 argv (flags: --verbose, --timeout)
2. dws-probe:
   a. which dws → 失败: exit 1 + 安装链接
   b. dws --version → 校验 ≥ 最低支持版本
   c. dws auth status → 未登录: 降级模式 (只暴露 bootstrap tool)
3. schema-loader:
   a. exec `dws schema --format json` (超时 30s)
   b. 解析为 { products: [{ id, tools: [{ name, description, parameters }] }] }
   c. 每个 tool 转成 MCP ToolDefinition:
      - name: `dingtalk.<product>.<action>` (点号命名空间)
      - description: dws 的 description 字段
      - inputSchema: dws parameters → JSON Schema (Draft 2020-12)
4. server.ts 注册所有 tools, 启动 stdio transport
5. ready, 长驻
```

### 3.4 运行时：tools/call 处理

```
incoming: tools/call { name: "dingtalk.todo.task_create", arguments: {...} }

1. 查注册表 → 得到 dws subcommand 映射
2. arguments → CLI flags (src/dispatch.ts)
   - string/number: --key value
   - boolean: --key (true) / 不加 (false)
   - array: --key v1 --key v2  或  --key v1,v2 (依 dws 实测)
   - object: --key-json '{...}' (启动时探测 dws 是否支持)
3. spawn('dws', [subcommand, ...flags, '--yes', '--format', 'json'],
         { timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] })
4. 结束:
   - exit 0 + valid JSON: content: [{ type: 'text', text: stdout }]
   - exit 0 + 非 JSON: 降级 text content
   - exit != 0: isError: true, content 含 stdout + stderr + exit code
   - timeout: kill + isError + 明确文案
```

### 3.5 错误归一化

| 场景 | MCP 返回 | agent 可执行动作 |
|------|---------|-----------------|
| dws 未安装 | 启动期 exit 1 | 用户读 stderr 装 |
| dws 过旧 | 启动期 exit 1 | `dws upgrade` |
| auth 过期 | `isError: true` + 文案 | agent 提示 `dws auth login` |
| tool call timeout | `isError: true` | agent 重试或放弃（**不自动重试**） |
| JSON parse fail | `isError: false` + text content | agent 自行解读 |
| dws exit != 0 | `isError: true` + stderr | agent 根据 stderr 判断 |

### 3.6 版本策略

- T1 SemVer 独立于 dws
- `package.json` 声明 `dwsMinVersion: "X.Y.Z"`
- T1 主版本号只在 **MCP 协议破坏性变更** 或 **dws 最低版本要求大升级** 时 bump

### 3.7 发行

- npm scoped public 包：`@yoji/dingtalk-workspace-mcp`
- 用户配置（任意 MCP host）：
  ```yaml
  # Hermes 示例
  mcp_servers:
    dingtalk:
      command: "npx"
      args: ["-y", "@yoji/dingtalk-workspace-mcp"]
      timeout: 180
  ```
- GitHub Actions：tag push → `npm publish` + GitHub Release

---

## 4. T2：Hermes Extensions

### 4.1 立项准入门槛（硬性）

新 ext 必须满足以下**全部**条件：

1. **Hermes 独家能力依赖**：用 delegate_tool / trajectory_compressor / memory_tool / Honcho / 长驻 cron 状态保持……缺一不可
2. **Hermes 现成方案做不到**：用 Hermes 原生 cron + `deliver="dingtalk"` + 一份 prompt 已经够了？ → 砍掉，写进 ext-cron-templates
3. **真实痛感验证**：自己用 T1 + Hermes 原生组合先撑 1-2 周，痛感够强再立项
4. **不依赖未实现的别的 ext**：ext 之间正交

### 4.2 v0.2：ext-stateful-watch（B6 精简版）

**痛点**：Hermes cron 是无状态的——每次触发都是干净 prompt，无法记住"上次扫到这条 @ 我已经告警过了"。

**做的事**（仅此一件）：
- 维护"已告警事件"的本地状态（JSONL）
- 每次 cron 触发**前**做事件过滤，把"新增未告警"列表注入 prompt
- 不做规则定义、不做 LLM 调用、不做推送（这些都用 Hermes 原生）

**接入形态**：利用 Hermes `cron/jobs.py` 的 **`script` 参数**（pre-run Python 脚本，stdout 拼接到 prompt 前面）。这是研究后选定的最优形态，对比详见 `docs/HERMES_INTEGRATION.md` §3.2。

**为什么不做 Hermes plugin**：研究 `D:\Hermes_Agent\plugins\` 后发现，plugins 系统目前只服务 memory provider 和 context engine 两类 ABC，**不是通用 tool plugin 机制**。要走这条路就得 fork Hermes，不可接受。

**为什么不做独立 MCP server**：状态去重逻辑和 dws 调用强耦合（去重需要拉最近事件），分两个 server 反而割裂。`script` 参数对 cron 场景**天然契合**：触发 → 过滤 → 拼 prompt → agent 行动，单进程链路最短。

**运行流程**：
```
cron 触发
  ↓
script: dedup_filter.py
  - 通过 MCP 调 T1 拉最近 @ 我消息
  - 读 ~/.hermes/dingtalk-extensions/state/unreplied_mentions.jsonl
  - 过滤掉已告警的
  - 写 stdout: "你有 N 条新的未回 @ 消息：..."
  ↓
prompt 拼上述 stdout
  ↓
agent 用 dingtalk.* 工具起草回复，deliver=dingtalk 推送
```

**目录**：
```
hermes-extensions/ext-stateful-watch/
├── scripts/
│   └── dedup_filter.py     # cron script 主体
├── lib/
│   ├── __init__.py
│   ├── state.py            # JSONL 读写
│   └── dws_client.py       # 通过 MCP 调 T1（轻量 client）
├── templates/
│   └── unreplied_mentions.yaml  # 配套 cron job 模板
├── tests/
├── pyproject.toml          # pipx 安装
└── README.md
```

**状态文件**：`~/.hermes/dingtalk-extensions/state/<category>.jsonl`
- 每行 `{event_id, category, first_seen, last_alerted_at}`
- 触发迁移阈值：单文件 > 50MB → SQLite

**降级路径**：如未来 Hermes `script` 参数被弃用或行为变化，降级方案是把 dedup 改写为独立 MCP server，让 agent 通过 prompt 显式调 `dingtalk.dedup_check` tool。降级方案在 ext-stateful-watch 启动期自检：dry-run 一次 cron 创建，失败则提示用户切降级模式。

### 4.3 v0.3：ext-long-content（B5）

**痛点**：单 LLM 调用处理 10 万字会议纪要会爆 context；dws 只能 `get` 文档，不能"理解 + 拆分 + 分发"。

**做的事**：提供一组 Hermes skill + helper，把"长内容 → 结构化产出"流水线化：
- 拉钉钉闪记 transcript（通过 T1）
- delegate 子 agent 分段总结
- trajectory_compressor 合并
- 拆出待办 → @ 人 → 写回钉钉文档（通过 T1）

**目录**：
```
hermes-extensions/ext-long-content/
├── skills/
│   └── meeting_followup.md      # Hermes skill
├── src/
│   └── pipeline.py              # delegate 编排辅助
├── tests/
├── pyproject.toml
└── README.md
```

### 4.4 v0.1：ext-cron-templates（零代码）

**核心洞察**：调研发现 Hermes cron 已经能覆盖日报/周报/月报这类场景。我们要做的不是写代码，而是**沉淀经过验证的 prompt 模板**。

**做的事**：
- 提供 3-5 份高质量 cron prompt（日报、周报、月报、待办催办、考勤汇总）
- 提供安装脚本：`npx @yoji/dingtalk-workspace-mcp install-cron-templates` → 拷贝到 `~/.hermes/cron/templates/dingtalk/`
- 用户启用方式：`hermes cronjob create --from <模板路径>`（具体命令以 v0.1 实测为准）

**⚠ v0.1 实施前必须验证**：Hermes 当前 `cron/jobs.py` 的 `create_job()` 接受 prompt/schedule/skills/deliver/script 等结构化参数，但**未在源码中确认是否存在"模板目录约定"或"`--from <yaml>`"CLI 子命令**。两种实施分支：
- **若 Hermes 支持模板目录**：直接拷贝 yaml 到 `~/.hermes/cron/templates/dingtalk/`，文档教用户跑一行命令
- **若不支持**：install-cron-templates 改为生成一组 `hermes cronjob create --schedule "..." --prompt "..." --deliver dingtalk` shell 命令脚本（功能等价、对 Hermes 零假设）

无论走哪条分支，**最终交付给用户的体验是"一行命令启用一个 cron 任务"**，差别只在我们这边怎么打包。

**目录**：
```
hermes-extensions/ext-cron-templates/
├── templates/
│   ├── daily_brief.yaml        # 含 schedule + prompt
│   ├── weekly_report.yaml
│   ├── monthly_summary.yaml
│   ├── overdue_todos.yaml
│   └── attendance_digest.yaml
├── install.sh
├── README.md
└── tests/
    └── prompt_smoke_test.py    # 离线渲染验证
```

**为什么算 "ext" 而不是普通文档**：因为它是项目的官方分发物、有版本号、`install.sh` 是实际命令。

---

## 5. 已知约束与风险

### 5.1 参数序列化（T1 最大风险）

dws 嵌套参数的 CLI 表示需要实测。**动 T1 代码前必须验证**：
- `dws aitable record query` 的 `filter` 参数（最复杂）
- `dws calendar event create` 的 `attendees` 数组
- `dws todo task create` 的 `executors` 数组

验证产出：`docs/decisions/001-param-serialization.md`

### 5.2 dws schema 稳定性

dws 升级改 schema 输出格式 → T1 炸。缓解：
- 启动时版本检测
- schema 解析 defensive（未知字段 skip + 日志）
- 异常降级到只暴露 `dingtalk.raw_invoke(cmd, args)` 兜底 tool

### 5.3 npx 冷启动

首次 `npx -y` 拉包 10-30s。**缓解**：README 首页预告 + 启动时 stderr 提示。

### 5.4 T2 的"独家"判断退化

随时间推移，Hermes 可能新增能力让 T2 ext 变得不再独家。**应对**：
- 每个 ext README 写明"它独家在哪"
- 半年一次审查，不再独家的 ext 转为"建议替换为 Hermes 原生 + prompt"，3 个版本后弃用

### 5.5 仓库名误导

仓库叫 `Hermes-dingtalk`，但 T1 是 host-agnostic。**应对**：
- README 首屏第一句就强调 "T1 通用，T2 是 Hermes 加分包"
- 不改仓库名（避免破坏链接）

---

## 6. 不做清单（YAGNI 防线）

**v0 (T1) 不做**：
- token 管理、OAuth UI（归 dws）
- npm postinstall 自动下载 dws（用户自装）
- 组合 tool（等真实使用数据）
- Hermes 专用优化（违反 host-agnostic）

**T2 不做**：
- 重写 Hermes 原生已覆盖的能力（messaging adapter / cron / mcp_tool）
- 不依赖 Hermes 独家能力的"通用扩展"（应该走 T1 + prompt）
- 多用户/多租户（v1.0+ 再考虑）
- Web 管理界面

**整个项目不做**：
- 飞书/Slack/Teams/微信
- 自建 DingTalk SDK
- 绕过 dws 直调钉钉 API

---

## 7. 术语表

| 术语 | 含义 |
|------|------|
| **T1** | dingtalk-workspace-mcp，host-agnostic 的核心交付 |
| **T2** | hermes-extensions，Hermes 专属加分包 |
| **dws** | DingTalk Workspace CLI，Go 写的钉钉命令行工具 |
| **Hermes** | Nous Research 的 Python agent 框架 |
| **B4/B5/B6** | brainstorming 阶段的方向编号；B4 已被砍并由 ext-cron-templates 替代，B5→ext-long-content，B6→ext-stateful-watch |
| **MCP host** | 消费 MCP server 的 agent 框架（Claude Desktop / Cursor / Codex / Hermes 等） |
| **MCP** | Model Context Protocol，Anthropic 推的 agent tool 协议 |
| **dws schema** | `dws schema --format json` 输出，描述所有 dws tool 的元信息 |
