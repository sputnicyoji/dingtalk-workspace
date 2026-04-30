# dingtalk-workspace-mcp Roadmap

**最后更新**：2026-04-30（重写——砍掉 T2 ext 计划，纯主包路线图）
**节奏原则**：每版交付一个独立可用增量。任何版本超期 50% → 砍范围，不延期。

---

## 当前状态

**npm 包**：`@sputnicyoji/dingtalk-workspace-mcp@0.0.4`（已发布）
**Git tag**：v0.0.1 / v0.0.2 / v0.0.4 / `milestone-v0.2`（legacy 封档）
**Host 集成**：Claude Code 与 Hermes 均已接入验证，通过全局 bin 共用，端到端 82 tools 可调
**项目 milestone**：**v0 已闭环**，**v0.1 进行中**（70% 完成）

---

## 版本号约定

只有一层 SemVer：`@sputnicyoji/dingtalk-workspace-mcp@x.y.z`

| 步进 | 含义 |
|------|------|
| patch | parser bug fix |
| minor | 新解析能力或 schema 输出变化 |
| major | MCP 协议不兼容 或 dws 最低版本大升级 |

项目 milestone（v0 / v0.1 / v0.2 ...）是阶段标签，不绑定 npm 版本。

---

## v0 — MCP Server 首发 ✅ DONE

**目标**：任何 MCP host 加 4 行配置即可调用 dws 全部能力。

**实际交付**（2026-04-13 / 04-14）：
- ✅ `@sputnicyoji/dingtalk-workspace-mcp` v0.0.1 - v0.0.4 发布
- ✅ help-tree 动态 schema 生成（ADR-002 下线 schema-json 路径）
- ✅ dispatch 层（args → CLI flags，json_array / json_object / array 语义提升 + ADR-001）
- ✅ 错误归一化：`NOT_INSTALLED` / `VERSION_TOO_OLD` / `AUTH_EXPIRED` / `TIMEOUT` / `NON_ZERO_EXIT`
- ✅ GitHub Actions CI + npm publish workflow
- ✅ Hermes / Claude Code 双 host 接入文档

**退出标准对照**：
- ✅ 冷启动 < 30s（实测 4-7s）
- ✅ Hermes + Claude Code 各自接入，82 tools 可调用，真实 API call 成功
- ✅ `dws aitable record query` 嵌套 `filter` 参数序列化（ADR-001 §D2 json_object 路径）
- ✅ auth 未完成时降级 bootstrap-only（schema-loader.ts loadAll）
- ✅ 86/86 Vitest 测试通过

---

## v0.1 — 稳健化 + 差异化叙事 🟡 70%

**目标**：让"为什么选我们而不是其他 6 个 DingTalk MCP"有据可查。

**已交付**：
- ✅ bug 修复：v0.0.2 cobra 布尔 flag、v0.0.4 全角（必填）识别
- ✅ `docs/COMPARISON.md`：6 个现存项目对比矩阵 + 两个分水岭维度 + 按场景推荐
- ✅ ADR-003：`report.create` 契约（key=field_name + 字段规约）
- ✅ ADR-004：dws 隐式 required flag 清单
- ✅ 上游 dws issue #106 + #107 已上报

**剩余范围**：
- [ ] 主包连续运行 1 周无崩溃验证
- [ ] README 首屏置顶链接 COMPARISON.md（已完成基本结构，需复核首屏可见性）
- [ ] milestone tag `milestone-v0.1`

**退出标准**：
- [ ] 连续运行 1 周无崩溃
- [ ] COMPARISON.md 在 README 首屏置顶链接

**不做**：业务逻辑、host 专属优化、polling 代码。

---

## v0.2 — legacy 封档 ✅ ARCHIVED

**原计划**：交付 `ext-stateful-watch`（Hermes 专属跨周期状态告警）。

**实际**：MVP 代码完成（64 测试通过、live spot-check 验证），但战略评审后**砍掉双轨设计**——主包专注 host-agnostic 通用性，Hermes 专属扩展不再是产品线一部分。

**封档**：
- 代码归档至 `legacy/hermes-extensions/`（含 `ext-stateful-watch` + `ext-cron-templates` 骨架）
- git tag `milestone-v0.2` 锁定封档点
- 不发 npm 包、不进后续路线图、不再迭代

详见 `docs/ARCHITECTURE.md` §6。

---

## v0.3 — 主包持续打磨 ⏳ 规划中

**目标**：在 v0.1 稳定运行基础上，把主包做到"长期低维护"。

**候选范围**（按 dws 升级与用户反馈优先级排序）：

- [ ] dws schema 输出富化：从 dws example 字段抽取 `inputSchema.examples`，让 LLM 一眼看到正确 payload 结构
- [ ] tool 描述质量提升：cobra help 顶部 1-2 行往往不够，考虑追加 flags 段语义说明
- [ ] 启动期 schema 缓存：进程间复用，避免每次 npx 冷启动重跑 help-tree（10-30s → <1s）
- [ ] Windows `npx` spawn 体验改善：当前需绕开走全局 bin，目标做到默认 `npx` 即用
- [ ] 上游 dws #106 / #107 修好后，下线 ADR-003 / ADR-004 部分清单

**前置工作**：
- v0.1 稳定 1 周
- 收集至少 3 个外部用户反馈

**退出标准**：
- 主包月均 npm 下载 ≥ 50（粗略 traction 指标）
- 至少处理 3 类用户反馈

---

## v0.4 — dws schema v2 兼容（按需启动）

**触发条件**：dws 出大版本，schema 格式变化。

**范围**：
- 主包 schema 解析对 dws v2 schema 的兼容
- 旧版本降级路径

不预先开工。dws 上游动作触发本版本。

---

## v1.0 — 何时算 "1.0"？

**判据（必须全部成立）**：
- 主包在 npm 上 ≥ 6 个月，月均下载 > 100
- 至少 5 个外部用户在 Yoji 之外的真实环境运行 ≥ 1 个月
- COMPARISON.md 中所有"独家"差异点经第三方验证
- 文档完整度：每个核心模块有 README + 至少 1 个端到端示例
- 上游 dws #106 / #107 至少有 1 个被 fix（证明上游协作链路通）

**1.0 之前**：保持 0.x 节奏，破坏性变更随时可加（minor bump）。

---

## 节奏纪律

- **每个版本结束必须 ship**（npm publish / git tag）
- 下一版本开工前，当前版本需连续运行 ≥ 1 周无人工干预
- 任何版本超期 50% → 砍范围，不延期
- 任何新想法默认进 `ideas.md`，不中插当前版本
- **主包不引入业务逻辑、不引入 host 假设**（铁律，详见 ARCHITECTURE §1.4）

---

## 不再做的事

- **host 专属扩展**（任何形式）：早期 `hermes-extensions/` 已归档至 `legacy/`，不再扩展。如有特定 host 集成需求，走独立项目。
- **重写 dws**：上游官方维护，不重造轮子。
- **支持其他 IM**：飞书 / Slack / Teams / 微信都不在范围内。
- **token 管理 / OAuth UI**：全部委托 dws。
