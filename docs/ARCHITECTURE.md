# dingtalk-workspace-mcp 架构文档

**版本**：1.0（2026-04-30 简化——砍掉 T1/T2 双轨，纯 dws-driven MCP）
**状态**：架构冻结，主包稳定迭代

---

## 1. 项目定位

### 1.1 一句话定位

一个 dws-driven、动态全覆盖的钉钉 MCP server，所有 MCP host 通用。

### 1.2 为什么是这个定位

调研结论（详见 `docs/COMPARISON.md`）：

| 已存在 | 不存在 |
|--------|-------|
| dws CLI（钉钉官方，agent-native） | dws-driven 动态 MCP 适配器 |
| 5+ 独立 DingTalk MCP（手写固定子集） | 全产品自动覆盖、随 dws 升级零维护 |

**护城河**：钉钉官方走 "CLI + MCP 广场" 路径，明确不出官方 MCP server。本项目长期价值不会被官方覆盖归零。

### 1.3 三个硬指标

1. 用户接入任何 MCP host 的成本 ≤ 4 行配置
2. dws 升级新增产品/能力，wrapper **不改一行代码**自动暴露
3. 任何代码路径里都不出现 host 假设（"如果是 Hermes 就……"）

### 1.4 为什么不走其他路径（反面论证）

接入"钉钉 → agent host"的候选路径一共就四条。本项目选 dws-driven dynamic wrapper 不是偏好，是**其他三条都有硬伤**。

**路径 A：手写固定 MCP（现存 5+ 实现走的路）**
- 覆盖不全：每家只写 20-30 个高频 tool，考勤/日报/AI 表格/审批常年缺席
- **dws 升级即坏**：钉钉走 "CLI + MCP 广场" 路线，dws 会持续加料——手写方案本质是债务工厂
- 每个 MCP host 都要重新接一遍

**路径 B：自建第一方 CLI / 直连钉钉 API**
- 要复刻的不只是命令行，是整个 OAuth 身份域：客户端注册、token 生命周期、自动刷新、多租户、企业 corpId 隔离
- **权限审批是组织级门槛**：钉钉开放平台每个能力域独立申请审批——第三方重走一遍等于**做一个钉钉 ISV**，个人开发者根本拿不到
- dws 作为官方 CLI 已经内置这一切，调它 = 白嫖官方身份域

**路径 C：做 host 专属 plugin（不走 MCP）**
- 只服务一家 host，放弃所有其他 MCP host
- 项目早期试过这条路（`legacy/hermes-extensions/`），结论是绑定单一 host 价值不抵成本

**路径 D：dws-driven dynamic MCP wrapper（本项目）**
- 协议翻译一层，不碰身份、不碰 token、不碰业务逻辑
- dws 升级 → `npx` 新版本 → **零改代码自动覆盖**
- 所有 MCP host 通用，投入产出比最大

**一句话**：身份 / 权限 / 业务域由 dws 承担，本项目只做 "CLI protocol ↔ MCP protocol" 的无状态翻译。这个边界一旦被破坏（引入任何 token 管理、业务逻辑、host 假设），本项目就退化回路径 A 或 C，丧失战略价值。

---

## 2. 系统结构

```
┌─────────────────────────────────────────────────────────┐
│  任意 MCP host                                          │
│  Claude Desktop / Cursor / Codex / Hermes / ...         │
└────────────────────┬────────────────────────────────────┘
                     │ MCP tools/call (stdio JSON-RPC)
┌────────────────────▼────────────────────────────────────┐
│  packages/dingtalk-workspace-mcp/                        │
│  无状态 MCP server: tools 动态由 dws schema 生成          │
│  进程模型: 长驻 stdio server, 每次 tool call spawn dws    │
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
| 主包 | MCP `tools/call` | JSON (dws stdout) | 无 | 任意 MCP host |

---

## 3. 主包：dingtalk-workspace-mcp 详述

### 3.1 核心思路

**"协议适配器"**——把 `dws CLI` 的 JSON 输出翻译成 MCP 协议。**不做任何业务增强**。任何业务逻辑都属于上游 agent prompt。

### 3.2 目录结构

```
packages/dingtalk-workspace-mcp/
├── src/
│   ├── cli.ts              # 入口, shebang, 参数解析
│   ├── server.ts           # MCP server 实例 + 生命周期
│   ├── schema-loader.ts    # 启动时遍历 `dws --help` 树, 转 MCP tool 定义
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

> Schema 发现策略由 [ADR-002](decisions/002-dws-dual-tool-surfaces.md) 修订：
> `dws schema --format json` 暴露的是与 CLI 不同的 MCP 表面（snake_case，不可机械还原 CLI 路径），
> 故下线 schema-json 路径，help-tree 成为唯一权威源。

```
1. 解析 argv (flags: --verbose, --timeout)
2. dws-probe:
   a. which dws → 失败: exit 1 + 安装链接
   b. dws --version → 校验 ≥ 最低支持版本
   c. dws auth status → 信息性 (不影响 schema 发现, 仅决定是否注册 bootstrap)
3. schema-loader.loadAll:
   a. schema-json 路径 → 始终 stub 返回空 (ADR-002)
   b. dws --help 树形并发遍历 (Promise.all, ~5s 完成 ~80 tools)
   c. 每个 leaf cobra 输出 → ParsedHelp → DwsToolSpec:
      - name: dingtalk.<service>.<...>.<action> (CLI 路径用点号连接)
      - description: cobra 顶部 1-2 行
      - flags: 解析 Flags 段, 按 ADR-001 §D1 提升语义类型
4. server.ts 注册全部 tools (+ bootstrap 当 auth=false), 启动 stdio transport
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

- 主包 SemVer 独立于 dws
- `package.json` 声明 `dwsMinVersion: "X.Y.Z"`
- 主版本号只在 **MCP 协议破坏性变更** 或 **dws 最低版本要求大升级** 时 bump

### 3.7 发行

- npm scoped public 包：`@sputnicyoji/dingtalk-workspace-mcp`
- 用户配置（任意 MCP host）：
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
- GitHub Actions：tag push → `npm publish` + GitHub Release

---

## 4. 已知约束与风险

### 4.1 参数序列化（最大风险）

dws 嵌套参数的 CLI 表示需要实测。**动主包代码前必须验证**：
- `dws aitable record query` 的 `filter` 参数（最复杂）
- `dws calendar event create` 的 `attendees` 数组
- `dws todo task create` 的 `executors` 数组

验证产出：`docs/decisions/001-param-serialization.md`

### 4.2 dws schema 稳定性

dws 升级改 schema 输出格式 → 主包炸。缓解：
- 启动时版本检测
- schema 解析 defensive（未知字段 skip + 日志）
- 异常降级到只暴露 `dingtalk.raw_invoke(cmd, args)` 兜底 tool

### 4.3 npx 冷启动

首次 `npx -y` 拉包 10-30s。**缓解**：README 首页预告 + 启动时 stderr 提示。

### 4.4 仓库名遗留

仓库叫 `Hermes-dingtalk`，但项目本体是 host-agnostic 的 npm 包 `@sputnicyoji/dingtalk-workspace-mcp`。**应对**：
- README 首屏第一句就强调本体是 npm 包
- 不改仓库名（避免破坏链接）
- 早期 Hermes 专属代码归档在 `legacy/`，封档点 git tag `milestone-v0.2`

---

## 5. 不做清单（YAGNI 防线）

**主包不做**：
- token 管理、OAuth UI（归 dws）
- npm postinstall 自动下载 dws（用户自装）
- 组合 tool（等真实使用数据）
- 任何形式的 host 专用优化（违反 host-agnostic）
- 业务逻辑（报告模板、身份解析、告警规则）

**整个项目不做**：
- 飞书/Slack/Teams/微信
- 自建 DingTalk SDK
- 绕过 dws 直调钉钉 API
- 给 `legacy/` 加新代码（封档，只接受 bug 修复）
- 在主仓库新开 host 专属扩展（破坏定位，应另起项目）

---

## 6. `legacy/` 说明

`legacy/hermes-extensions/` 是早期"T1 通用 MCP + T2 Hermes 专属扩展"双轨设计的产物。包含：

- `ext-stateful-watch`：3 个 watcher（approvals / reports / todos）+ 64 个测试
- `ext-cron-templates`：daily_brief.yaml prompt 模板骨架

**为什么砍**：T2 的存在天然破坏 host-agnostic 红线——ext 用 Hermes 独家 API 写的告警规则，只对 Hermes 用户有价值，对其他 90% 用户是噪音。继续维护意味着仓库需要两条产品线、两套测试、两套发布——投入产出比远低于把精力集中在主包通用性。

**封档**：git tag `milestone-v0.2`。代码原样保留作参考，不再迭代、不发包、不进路线图。

---

## 7. 术语表

| 术语 | 含义 |
|------|------|
| **dws** | DingTalk Workspace CLI，Go 写的钉钉命令行工具 |
| **MCP host** | 消费 MCP server 的 agent 框架（Claude Desktop / Cursor / Codex / Hermes 等） |
| **MCP** | Model Context Protocol，Anthropic 推的 agent tool 协议 |
| **dws schema** | `dws --help` 树形遍历 + cobra 解析得到的 tool 元信息 |
| **legacy** | 早期 Hermes 专属扩展，已封档不再迭代 |
