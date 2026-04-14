# Hermes-DingTalk Roadmap

**最后更新**：2026-04-14
**节奏原则**：每版交付一个独立可用增量，不预先构建上层让下层半成品堆积。任何版本超期 50% → 砍范围，不延期。

---

## 当前状态

**npm 包**：`@sputnicyoji/dingtalk-workspace-mcp@0.0.4`（已发布）
**Git tag**：v0.0.1 / v0.0.2 / v0.0.4
**Host 集成**：Hermes（D:\Hermes_Agent\）+ Claude Code 双栈通过全局 bin 共用，端到端 82 tools 可调
**项目 milestone**：**v0 已闭环**，**v0.1 进行中**（70% 完成）

---

## 版本号约定

两层版本，不要混淆：

| 维度 | 含义 | 步进规则 |
|------|------|---------|
| **npm 包版本** `@sputnicyoji/dingtalk-workspace-mcp@x.y.z` | T1 单独的 SemVer | patch=parser bug fix；minor=新解析能力或 schema 输出变化；major=MCP 协议不兼容或 dws 最低版本大升级 |
| **项目 milestone** `v0 / v0.1 / v0.2 / ...` | 整个 repo 的阶段（含 T1 + T2 modules） | 每完成一个 milestone tag `milestone-vX.Y` |

T1 npm 版本独立步进（v0.0.4 当前），不被 milestone 绑死——milestone 推进时 T1 可能多次小升级。

---

## v0 — T1 MCP Server 首发 ✅ DONE

**目标**：任何 MCP host 加 4 行配置即可调用 dws 全部能力。

**实际交付**（2026-04-13 / 04-14）：
- ✅ `@sputnicyoji/dingtalk-workspace-mcp` v0.0.1 - v0.0.4 发布
- ✅ help-tree 动态 schema 生成（ADR-002 下线 schema-json 路径）
- ✅ dispatch 层（args → CLI flags，json_array / json_object / array 语义提升 + ADR-001）
- ✅ 错误归一化：`NOT_INSTALLED` / `VERSION_TOO_OLD` / `AUTH_EXPIRED` / `TIMEOUT` / `NON_ZERO_EXIT`
- ✅ GitHub Actions CI + npm publish workflow（CI 暂走手动绕开私有仓库账单）
- ✅ Hermes / Claude Code 双 host 接入文档

**退出标准对照**：
- ✅ 冷启动 < 30s（实测 4-7s）
- ✅ Hermes + Claude Code 各自接入，82 tools 可调用，真实 API call 成功
- ✅ `dws aitable record query` 嵌套 `filter` 参数序列化（ADR-001 §D2 json_object 路径）
- ✅ auth 未完成时降级 bootstrap-only（schema-loader.ts loadAll）
- ✅ 84/84 Vitest 测试通过（覆盖 schema-loader / dispatch / dws-probe / errors）

---

## v0.1 — T1 稳健化 + 差异化叙事 + ext-cron-templates 🟡 70%

**目标**：让"为什么选我们而不是其他 6 个 DingTalk MCP"有据可查；同时给 Hermes 用户一份开箱即用的 cron prompt 包。

**已交付**：
- ✅ T1 bug 修复：v0.0.2 cobra 布尔 flag、v0.0.4 全角（必填）识别
- ✅ `docs/COMPARISON.md`：6 个现存项目对比矩阵 + 两个分水岭维度 + 按场景推荐
- ✅ ADR-003：`report.create` 契约（key=field_name + 字段规约）
- ✅ ADR-004：dws 隐式 required flag 清单（B+C 路径，T1 不动 src）
- ✅ 上游 dws issue #106 + #107 已上报
- ✅ `hermes-extensions/ext-cron-templates/` 骨架（README + 准入原则 + daily_brief.yaml v0.1-draft）

**剩余范围**：
- [ ] T1 连续运行 1 周无崩溃验证
- [ ] README 首屏置顶链接 COMPARISON.md
- [ ] **再做 2-4 份 cron 模板**（候选：`weekly_report` / `monthly_summary` / `overdue_todos` / `attendance_digest`）——`daily_brief` 已是模板范式
- [ ] **install.sh 形态决策**：等 Hermes `cronjob` CLI 入口稳定后决定走"拷贝模板目录"还是"生成 `hermes cronjob create` 命令脚本"（详见 ARCHITECTURE §4.4 未决分支）
- [ ] milestone tag `milestone-v0.1`

**退出标准**：
- [ ] T1 连续运行 1 周无崩溃
- [ ] COMPARISON.md 在 README 首屏置顶链接
- [ ] 至少 1 份 cron 模板在 Yoji 自己的 Hermes 上跑通 5 个工作日

**不做**：写 polling 代码、状态持久化、告警去重（→ v0.2）。

---

## v0.2 — ext-stateful-watch ⏳ 未启动

**目标**：补齐 Hermes cron 唯一缺失的能力——跨周期状态去重，让"@ 我超 2h 未回告警"这类规则不重复刷屏。

**范围**：
- `hermes-extensions/ext-stateful-watch/`
- 实施形态：Hermes cron `script` 参数（pre-run Python 注入 prompt）。详见 ARCHITECTURE §4.2
- 状态文件：`~/.hermes/dingtalk-extensions/state/<category>.jsonl`
- 配套 cron prompt 模板：`unreplied_mentions.yaml`

**前置工作**：
- [ ] ADR-005：状态文件 schema + 版本演进 + 50MB 阈值的 SQLite 迁移触发
- [ ] 验证 Hermes `script` 参数当前形态（读 `D:\Hermes_Agent\hermes_cli\cron\jobs.py`）

**退出标准**：
- [ ] 连续 1 周："@ 我未回" 告警不重复推送
- [ ] dedup 单元测试 ≥ 80%
- [ ] 状态文件 schema 有版本号 + 向后兼容方案明确
- [ ] 降级方案验证（Hermes `script` 参数被弃用时切换为独立 MCP server）

**不做**：UI、多租户、外发渠道（非钉钉）。

---

## v0.3 — ext-long-content ⏳ 未启动

**目标**：把"长会议/长文档 → 结构化纪要 + 待办分发"流水线化，发挥 Hermes delegate + trajectory_compressor 的独家能力。

**范围**：
- `hermes-extensions/ext-long-content/`
- Hermes skill：`meeting_followup.md`
- pipeline.py：delegate 编排辅助（拉闪记 → 分段 delegate → 合并 → 拆待办 → 分发）
- 用户唤起：on-demand（v0.3 不做事件触发）

**前置工作**：
- [ ] 调研 Hermes `delegate_tool` / `trajectory_compressor` 内部 API（`D:\Hermes_Agent`）
- [ ] 准入复核：写一份"为什么 T1 + Hermes 原生 prompt 做不到"的反面论证

**退出标准**：
- [ ] 拿一份真实会议（>1h）跑通：纪要可读、待办拆分准确率 > 70%、@ 人正确
- [ ] 失败优雅降级（delegate 子 agent 挂掉 → 部分纪要 + 错误说明）

**不做**：自动会议监听、组织耦合定制。

---

## v0.4 — T1 长期演进 + 现有 ext 调优

**触发条件**（按需启动，不固定时长）：
- dws 出大版本，schema 格式变化
- 已发 ext 收集到 ≥ 3 类用户反馈
- 上游 dws #106 / #107 修好后，可下线 ADR-003 / ADR-004 部分清单

**范围（候选）**：
- T1 schema 解析对 dws v2 schema 的兼容
- ADR-003 / ADR-004 清单收敛（dws help 修了 → 我们对应行删除）
- ext-stateful-watch 阈值 tuning + 新 category 支持

---

## v0.5+ — 新 ext 立项（按真实需求驱动）

候选清单（**非承诺**，按真实痛感排序）：

| 候选 | 依赖 Hermes 独家能力 | 真实痛感验证 |
|------|-------------------|-------------|
| ext-meeting-prep（会议前 10 分钟自动备资料） | cron 状态 + delegate | 待自用验证 |
| ext-decision-log（决策日志写 AITable） | memory_tool + Honcho | 待自用验证 |
| ext-org-coord（跨组协调多步追踪） | delegate + 长跨度状态 | 待，依赖身份解析 |

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
- 上游 dws #106 / #107 至少有 1 个被 fix（证明上游协作链路通）

**1.0 之前**：保持 0.x 节奏，破坏性变更随时可加（minor bump）。

---

## 节奏纪律

- **每个版本结束必须 ship**（npm publish / git tag）
- 下一版本开工前，当前版本需连续运行 ≥ 1 周无人工干预
- 任何版本超期 50% → 砍范围，不延期
- 任何新想法默认进 `v0.5+ 候选清单` 或单开 `ideas.md`，不中插当前版本
- **T1 修改不引入业务逻辑**（铁律，详见 ARCHITECTURE §1.4）

---

## 下一步行动（v0.1 收尾）

按重要性排序：

1. **再做 2-4 份 cron 模板** ——`daily_brief` 范式已立，复用容易
2. **README 首屏置顶 COMPARISON 链接**（一次 commit）
3. **真实运行 1 周观察期** —— 这期间不动 T1 src/，只观察、记录
4. v0.1 退出时 git tag `milestone-v0.1` 并复盘

期间 T2 v0.2 设计可以并行（不阻塞 v0.1 验证期）。
