# Hermes-DingTalk 进度

> 跟踪 T1/T2 双轨交付进度。权威架构在 `docs/ARCHITECTURE.md`，版本节奏在 `docs/ROADMAP.md`。

## 当前状态

- **分支**: main
- **最新提交**: a235522 — chore: 包名迁移 @yoji/* → @sputnicyoji/*
- **npm 发布**: `@sputnicyoji/dingtalk-workspace-mcp@0.0.1`（2026-04-13 手动发布）
- **Git tag**: v0.0.1

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
- [x] 手动发布 v0.0.1 到 npm
- [x] Hermes 本地端到端验证（82 个 tool 暴露，真实 API 调用成功)

### 待办

- [ ] CI 付费账单问题（hermes-dingtalk 为私有仓库，消耗付费分钟数）
- [ ] Windows 下 `npx` MCP 启动失败（shell spawn 找不到 binary）
- [ ] `docs/COMPARISON.md` v0.1 必交付
- [ ] v0.1 版本规划

## T2 — `hermes-extensions/`（未启动）

- [ ] `ext-cron-templates`（v0.1 附带）
- [ ] `ext-stateful-watch`（v0.2）
- [ ] `ext-long-content`（v0.3）

**准入门槛**：必须满足"离开 Hermes 独有能力就做不出"。

## 已知问题

1. **CI 账单**：私有仓库消耗 GitHub Actions 付费分钟数，目前走手动发布规避
2. **Windows npx 启动**：shell 找不到 binary，需要配 `cmd /c` 包装
3. **Hermes `mcp list` 编码**：Windows GBK 控制台崩溃，需 `PYTHONIOENCODING=utf-8`
