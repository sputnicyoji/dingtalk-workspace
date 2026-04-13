# Hermes-DingTalk Roadmap

**最后更新**：2026-04-13（基于公开仓库调研重写）
**节奏原则**：每版交付一个独立可用增量，不预先构建上层让下层半成品堆积。任何版本超期 50% → 砍范围，不延期。

---

## v0 — T1 MCP Server 首发（2-3 工作日）

**目标**：任何 MCP host（Hermes/Cursor/Claude Desktop/Codex）加 4 行配置即可调用 dws 全部能力。

**范围**：
- `@yoji/dingtalk-workspace-mcp` npm 包首发
- 启动时 `dws schema` 动态生成 tool（dingtalk.<product>.<action> 命名空间）
- dispatch 层处理 args → CLI flags 映射
- 错误归一化（dws 未装 / auth 过期 / timeout）
- GitHub Actions CI + `npm publish`
- README 含"两步接入"文档（含至少 3 个 host 的配置示例）

**退出标准**：
- [ ] `npx -y @yoji/dingtalk-workspace-mcp` 冷启动 < 30s ready
- [ ] Hermes / Claude Desktop 各自接入后能成功调 `dingtalk.todo.task_create` + `dingtalk.contact.user_get_self`
- [ ] `dws aitable record query` 嵌套 `filter` 参数能正确传递（参数序列化硬骨头）
- [ ] auth 未完成时降级到 `dingtalk.bootstrap` tool，不崩溃
- [ ] Vitest 覆盖 schema-loader + dispatch 两个关键模块 ≥ 80%

**前置工作**：
- [ ] `docs/decisions/001-param-serialization.md`（实测 dws 嵌套参数的 CLI 表示）

**不做**：状态、认证、业务逻辑、组合 tool、Hermes 专用优化。

---

## v0.1 — T1 稳健化 + 差异化叙事 + ext-cron-templates（2-3 工作日）

**目标**：让"为什么选我们而不是其他 5 个 DingTalk MCP"有据可查；同时给 Hermes 用户一份开箱即用的 cron prompt 包。

**范围**：
- T1 bug 修复 + 1 周连续运行验证
- `docs/COMPARISON.md`：对比表（vs `wllcnm/dingding0646`、`claude-code-community/dingtalk-mcp-server`、`fishwww-ww/dingtalk-mcp`、`ianen/dingtalk-wiki-mcp`、官方 `DingTalk Agent Client`）
  - 维度：覆盖产品数、是否随 dws 升级自动同步、host 中立性、安装复杂度、auth 模型
- `hermes-extensions/ext-cron-templates/` 首发：3-5 份 prompt 模板（daily_brief / weekly_report / monthly_summary / overdue_todos / attendance_digest）
- 安装脚本：`npx @yoji/dingtalk-workspace-mcp install-cron-templates`

**退出标准**：
- [ ] T1 连续运行 1 周无崩溃
- [ ] COMPARISON.md 在 README 首屏置顶链接
- [ ] 至少 1 份 cron 模板在 Yoji 自己的 Hermes 上跑通 5 个工作日

**不做**：写 polling 代码、状态持久化、告警去重（→ v0.2）。

---

## v0.2 — ext-stateful-watch（5 工作日）

**目标**：补齐 Hermes cron 唯一缺失的能力——跨周期状态去重，让"@ 我超 2h 未回告警"这类规则不重复刷屏。

**范围**：
- `hermes-extensions/ext-stateful-watch/`
- Hermes plugin 注册 tool：`dingtalk.dedup_check(event_ids, category)` → `{new, suppressed}`
- 状态：`~/.hermes/dingtalk-extensions/state/<category>.jsonl`
- 配套 cron prompt 模板：`unreplied_mentions.yaml`（演示如何配合 dedup_check 使用）
- 不做规则配置 DSL，不做 LLM 调用——这些都用 Hermes 原生能力 + prompt 表达

**退出标准**：
- [ ] 连续 1 周："@ 我未回" 告警不重复推送
- [ ] dedup_check API 单元测试 ≥ 80%
- [ ] 状态文件 schema 有版本号，向后兼容方案明确

**不做**：UI、多租户、外发渠道（非钉钉）。

---

## v0.3 — ext-long-content（5-7 工作日）

**目标**：把"长会议/长文档 → 结构化纪要 + 待办分发"流水线化，发挥 Hermes delegate + trajectory_compressor 的独家能力。

**范围**：
- `hermes-extensions/ext-long-content/`
- Hermes skill：`meeting_followup.md`
- pipeline.py：delegate 编排辅助（拉闪记 → 分段 delegate → 合并 → 拆待办 → 分发）
- 用户唤起：on-demand（v0.3 不做事件触发，等 Hermes 钉钉 adapter 暴露会议结束事件）

**退出标准**：
- [ ] 拿一份真实会议（>1h）跑通：纪要可读、待办拆分准确率 > 70%、@ 人正确
- [ ] 失败优雅降级（delegate 子 agent 挂掉 → 部分纪要 + 错误说明）

**不做**：自动会议监听、组织耦合定制。

---

## v0.4 — T1 长期演进 + 现有 ext 调优（按需，不固定时长）

**触发条件**：以下任一成立才启动
- dws 出大版本，schema 格式变化
- T2 ext 收集到 ≥ 3 类用户反馈
- 出现 v0.5 想做的新 ext 但需要 T1 配合

**范围（候选）**：
- T1 schema 解析对 dws v2 schema 的兼容
- ext-stateful-watch 阈值 tuning + 新 category 支持
- ext-long-content 加事件触发（依赖 Hermes adapter 演进）

---

## v0.5+ — 新 ext 立项（按真实需求驱动）

候选清单（**非承诺**，按真实痛感排序）：

| 候选 | 依赖 Hermes 独家能力 | 真实痛感验证 |
|------|-------------------|-------------|
| ext-meeting-prep（会议前 10min 自动备资料） | cron 状态 + delegate | 等 |
| ext-decision-log（决策日志写 AITable，B8） | memory_tool + Honcho | 等 |
| ext-org-coord（组织协调，B7） | delegate + 多步追踪 | 等，且依赖身份解析（B2） |

**立项规则**：
1. 自己用 T1 + Hermes 原生组合先撑 1 个月
2. 痛感够强 → 走 brainstorming 重新评估 ROI 四象限 + 三否决线
3. 通过 → 进 ROADMAP

---

## v1.0 — 何时算 "1.0"？

**判据（必须全部成立）**：
- T1 在 npm 上 ≥ 6 个月，月均下载 > 100
- 至少 2 个 ext 在 Yoji 之外的真实用户那里运行 ≥ 1 个月
- COMPARISON.md 中所有"独家"差异点经第三方验证
- 文档完整度：每个 module 有 README + 至少 1 个端到端示例

**1.0 之前**：保持 0.x 节奏，破坏性变更随时可加（minor bump 即可）。

---

## 节奏纪律

- **每个版本结束必须 ship**（npm publish / tag release）
- 下一版本开工前，当前版本需连续运行 ≥ 1 周无人工干预
- 任何版本超期 50% → 砍范围，不延期
- 任何新想法默认进 `v0.5+ 候选清单` 或单开 `ideas.md`，不中插当前版本

---

## 当前状态

**今天**：2026-04-13
**当前版本**：v0（尚未开始编码）
**下一步**：
1. 补 `docs/decisions/001-param-serialization.md`（实测 dws 嵌套参数）
2. 创建 `packages/dingtalk-workspace-mcp/` 骨架
3. 启动 T1 Layer 1 编码
