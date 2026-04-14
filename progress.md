# Hermes-DingTalk 进度

> 跟踪 T1/T2 双轨交付进度。权威架构在 `docs/ARCHITECTURE.md`，版本节奏在 `docs/ROADMAP.md`。

## 当前状态

- **分支**: main（已 push）
- **最新提交**: 91f5009 — docs: 标记 dws issue #107 已上报
- **npm 发布**: `@sputnicyoji/dingtalk-workspace-mcp@0.0.4`（2026-04-14；含全角（必填）parser 修复）
- **Git tag**: v0.0.1 / v0.0.2 / v0.0.4（v0.0.3 故意跳过——tarball 与 commit 不对齐）
- **Hermes / Claude Code 双 host 整合**：均通过全局 bin（`AppData/Roaming/npm/dingtalk-workspace-mcp.cmd`）共用，升级一次双吃

## T1 — `packages/dingtalk-workspace-mcp`

### v0 已完成（功能闭环）

- [x] 首版交付（1ce8822）+ 简化（cd807d1）
- [x] ADR-002：下线 schema-json 路径，help-tree 唯一权威源
- [x] ADR-003：`report.create` 契约（key=field_name + 字段规约 + dws CLI 不一致）
- [x] ADR-004：dws 隐式 required flag 清单（B+C 路径，T1 不动 src）
- [x] CI 工作流 + npm publish 工作流
- [x] 包名 `@sputnicyoji/*`
- [x] **v0.0.2** cobra 布尔 flag 修复 + `--version` 动态读包
- [x] **v0.0.4** 全角（必填）parser 识别（attendance.summary 等 29 工具受益）
- [x] 84/84 测试通过，tsc 清，含 6 条端到端回归用例
- [x] Windows `npx` spawn 问题绕开：直接指向全局 bin
- [x] Hermes + Claude Code 双 host 端到端验证：82 tools 全部加载

### 端到端测试结果（v0.0.4，2026-04-14）

11/15 工具 ✅；4 个失败按设计透传：
- `attendance.summary` / `oa.list-forms`：钉钉权限（C0002 / 200002）
- `oa.list-initiated` / `chat.send-by-bot`：dws 隐式 required（已落 ADR-004 + prompt 兜底）

### 上游 issues 已上报

- [#106](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/issues/106)：`report create --help` 缺 key=field_name 契约
- [#107](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/issues/107)：多个 flag 在 API 必填但 help 未标 `(必填)`

### 待办（v0.1 准备）

- [ ] **`docs/COMPARISON.md`**：v0.1 必交付，对比现存 5+ DingTalk MCP（差异化护城河）
- [ ] **`docs/ROADMAP.md`**：v0.1 节奏、特性闭锁线
- [ ] CI 付费账单：私有仓库消耗付费分钟，仍走手动发版
- [ ] T1 schema 输出富化（不破坏 host-agnostic 前提下）：考虑从 dws example 字段抽取 `inputSchema.examples`，让 LLM 一眼看到正确 payload 结构
- [ ] `--version` v0.0.4 字符串实测，必要时打 tag 备份记录

## T2 — `hermes-extensions/`

### 进行中

- [x] **`ext-cron-templates/`** v0.1-draft 骨架（`README.md` + `daily_brief.yaml`）
  - 内嵌 ADR-003（report.create 契约）+ ADR-004（隐式 required 清单）
  - **未做**：`install.sh`（待 Hermes cronjob CLI 入口形态稳定，详见 ARCHITECTURE §4.4）

### 进行中（cont.）

- [x] **`ext-stateful-watch`** v0.2-draft — MVP 代码完成（2026-04-14）
  - 形态：Hermes cron `script` 参数（pre-run Python，stdout 注入 prompt）
  - 准入：✓ 满足"离开 Hermes 独家能力做不出"
  - **范围重塑**（Task 1 probe 后）：@mention watcher 砍掉（dws 无 `chat message list`），改为 3 个 watcher：approvals / reports / todos
  - 基座：`lib/{event,state,dws_client,config,runtime}.py` + `lib/watchers/{approvals,reports,todos}.py`
  - 脚本：`scripts/watch_{approvals,reports,todos}.py`
  - 测试：**64 pass**（unit + e2e），<0.2s
  - Live verified：watch_todos 触发 8 条 first_alert + watch_reports 触发 8 条 delta；第二次运行均 silent
  - ADR-005：JSONL per-watcher，不用 SQLite
  - install.sh dry-install 通过
  - 待实战观察：启用 watch_todos cron 7 天

### 待启动

- [ ] **`ext-long-content`** v0.3：delegate 处理长会议/文档
  - 准入：✓ 依赖 Hermes delegate_tool / trajectory_compressor

**T2 准入门槛**：必须满足"离开 Hermes 独家能力就做不出"。

## 已知问题（环境层，不在 T1/T2 责任域）

1. **CI 账单**：私有仓库消耗 GitHub Actions 付费分钟数，目前走手动发布规避
2. **Windows npx 启动**：MSYS shell 翻译 `/c` → `C:/`，建议用全局 bin 绝对路径绕开
3. **Hermes `mcp list` 编码**：Windows GBK 控制台崩溃，需 `PYTHONIOENCODING=utf-8`

## 下一阶段建议（按优先级）

1. **v0.1 收尾文档**：`COMPARISON.md` + `ROADMAP.md`（半天）
2. **T2 ext-stateful-watch 设计**：写 ADR-005 + 选定状态文件 schema（一天）
3. **T2 ext-long-content brainstorming**：依赖 Hermes 内部 API 调研（半天）
