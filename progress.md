# Hermes-DingTalk 进度

> 跟踪 T1/T2 双轨交付进度。权威架构在 `docs/ARCHITECTURE.md`，版本节奏在 `docs/ROADMAP.md`。

## 当前状态

- **分支**: main（已 push）
- **最新提交**: 523f370 — docs: 补 §1.4 反面论证 + 新增根目录 progress.md
- **npm 发布**: `@sputnicyoji/dingtalk-workspace-mcp@0.0.1`（2026-04-13 手动发布；含 bug，见下）
- **Git tag**: v0.0.1
- **未发布**: abf0aed（cobra 布尔 flag 解析修复）待 v0.0.2 发版

## T1 — `packages/dingtalk-workspace-mcp`

### 已完成

- [x] v0 首版交付（1ce8822）
- [x] pass 简化：help-tree 并行化、spawn 去重、更严类型（cd807d1）
- [x] ADR-002：下线 `schema-json` 路径，help-tree 成为唯一权威源（da2097d）
- [x] GitHub Actions CI 工作流（f27a783）
- [x] npm publish 工作流（f27a783）
- [x] 包名迁移 `@yoji/*` → `@sputnicyoji/*`（a235522）
- [x] 81/81 测试通过（新增 3 条 2026-04-15 MCP 工具测试报告的回归用例）
- [x] 修复 `schema-loader.ts` FLAG_LINE_RE：cobra 布尔 flag（如 `todo task delete --yes`）被误判为 string 的 bug（FLAG_LINE_RE 类型组收紧到 `string|int` 白名单，空组当 boolean）
- [x] `docs/ARCHITECTURE.md` §1.4 反面论证：为什么不走其他三条路径（手写 MCP / 自建 CLI / Hermes 原生 plugin）
- [x] 2026-04-15 MCP 工具测试报告诊断完成：82 工具中真正 T1 bug 仅 1 个（已修）；2 个是 agent 传参错；6 类是权限/配置/数据依赖，按设计穿透不管
- [x] 手动发布 v0.0.1 到 npm
- [x] Hermes 本地端到端验证（82 个 tool 暴露，真实 API 调用成功)

### 待办

- [ ] **发版 v0.0.2**：带 cobra 布尔 flag 修复，重发 npm + 打 tag
- [ ] CI 付费账单问题（hermes-dingtalk 为私有仓库，消耗付费分钟数）
- [ ] Windows 下 `npx` MCP 启动失败（shell spawn 找不到 binary）
- [ ] `docs/COMPARISON.md` v0.1 必交付
- [ ] v0.1 版本规划
- [ ] Agent 侧文档：为描述带 API 字段名（如 `startTime`）的 flag 补 MCP schema 提示，防止 agent 误把描述当 key 名

## T2 — `hermes-extensions/`（未启动）

- [ ] `ext-cron-templates`（v0.1 附带）
- [ ] `ext-stateful-watch`（v0.2）
- [ ] `ext-long-content`（v0.3）

**准入门槛**：必须满足"离开 Hermes 独有能力就做不出"。

## 已知问题

1. **CI 账单**：私有仓库消耗 GitHub Actions 付费分钟数，目前走手动发布规避
2. **Windows npx 启动**：shell 找不到 binary，需要配 `cmd /c` 包装
3. **Hermes `mcp list` 编码**：Windows GBK 控制台崩溃，需 `PYTHONIOENCODING=utf-8`
