# dingtalk-workspace-mcp 进度

> 跟踪主包交付进度。权威架构在 `docs/ARCHITECTURE.md`，版本节奏在 `docs/ROADMAP.md`。
> 早期 host 专属扩展已归档至 `legacy/`，封档点 git tag `milestone-v0.2`。

## 当前状态

- **分支**: main
- **npm 发布**: `@sputnicyoji/dingtalk-workspace-mcp@0.0.4`（2026-04-14；含全角（必填）parser 修复）
- **Git tag**: v0.0.1 / v0.0.2 / v0.0.4（v0.0.3 故意跳过——tarball 与 commit 不对齐）
- **legacy 封档**: `milestone-v0.2`（2026-04-30）
- **Host 整合**：通过全局 bin（`AppData/Roaming/npm/dingtalk-workspace-mcp.cmd`）共用，多 host 升级一次生效

## 主包 — `packages/dingtalk-workspace-mcp`

### v0 已完成（功能闭环）

- [x] 首版交付（1ce8822）+ 简化（cd807d1）
- [x] ADR-002：下线 schema-json 路径，help-tree 唯一权威源
- [x] ADR-003：`report.create` 契约（key=field_name + 字段规约 + dws CLI 不一致）
- [x] ADR-004：dws 隐式 required flag 清单（B+C 路径，主包不动 src）
- [x] CI 工作流 + npm publish 工作流
- [x] 包名 `@sputnicyoji/*`
- [x] **v0.0.2** cobra 布尔 flag 修复 + `--version` 动态读包
- [x] **v0.0.4** 全角（必填）parser 识别（attendance.summary 等 29 工具受益）
- [x] 86/86 测试通过，tsc 清，含 6 条端到端回归用例
- [x] Windows `npx` spawn 问题绕开：直接指向全局 bin
- [x] 多 host 端到端验证：82 tools 全部加载

### 端到端测试结果（v0.0.4，2026-04-14）

11/15 工具 ✅；4 个失败按设计透传：
- `attendance.summary` / `oa.list-forms`：钉钉权限（C0002 / 200002）
- `oa.list-initiated` / `chat.send-by-bot`：dws 隐式 required（已落 ADR-004 + prompt 兜底）

### 上游 issues 已上报

- [#106](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/issues/106)：`report create --help` 缺 key=field_name 契约
- [#107](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/issues/107)：多个 flag 在 API 必填但 help 未标 `(必填)`

### 待办（v0.1 收尾）

- [ ] 主包连续运行 1 周无崩溃验证
- [ ] README 首屏复核：COMPARISON.md 链接位置
- [ ] milestone tag `milestone-v0.1`

### 候选（v0.3+ 规划中）

- [ ] schema 输出富化：抽取 `inputSchema.examples`
- [ ] tool 描述质量提升
- [ ] 启动期 schema 缓存（避免冷启动重跑 help-tree）
- [ ] Windows `npx` 体验改善
- [ ] 上游 #106 / #107 修好后，下线 ADR-003 / ADR-004 部分清单

## legacy/ — 已归档（2026-04-30）

原 T2 双轨设计的产物，已封档不再迭代。

### 内容

- **`ext-stateful-watch/`** — 跨周期状态告警 MVP
  - 形态：host cron 的 `script` 参数（pre-run Python，stdout 注入 prompt）
  - 3 个 watcher：`watch_approvals` / `watch_reports` / `watch_todos`
  - 基座：`lib/{event,state,dws_client,config,runtime}.py` + `lib/watchers/`
  - 测试：64 pass（unit + e2e），<0.2s
  - Live verified：watch_todos 触发 8 条 first_alert + watch_reports 触发 8 条 delta；第二次运行均 silent
  - install.sh dry-install 通过
- **`ext-cron-templates/`** — 日报 prompt 模板骨架（`README.md` + `daily_brief.yaml`）

### 为什么砍

详见 `docs/ARCHITECTURE.md` §6（host 专属扩展破坏 host-agnostic 红线）。

## 已知问题（环境层，不在主包责任域）

1. **CI 账单**：私有仓库消耗 GitHub Actions 付费分钟数，目前走手动发布规避
2. **Windows npx 启动**：MSYS shell 翻译 `/c` → `C:/`，建议用全局 bin 绝对路径绕开
3. **某些 host 的 `mcp list` 编码**：Windows GBK 控制台崩溃，需 `PYTHONIOENCODING=utf-8`

## 下一阶段建议（按优先级）

1. **v0.1 收尾**：1 周稳定性观察 + milestone tag
2. **v0.3 规划**：从候选清单选 1-2 项启动（建议优先 schema 缓存，冷启动是首要 UX 痛点）
