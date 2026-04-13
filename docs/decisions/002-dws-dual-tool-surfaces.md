# ADR 002 — dws 双 tool 表面与 schema-json 路径下线

**日期**：2026-04-13
**状态**：Accepted
**研究依据**：本机 dws v1.0.8 (windows/amd64), commit 31eb109。完成 `dws auth login` 后实测 `dws schema --format json` 输出（177KB JSON，固定为 `tests/fixtures/dws-schema-real.json`）。
**关联**：`docs/decisions/001-param-serialization.md` §D2（**作废**），`packages/dingtalk-workspace-mcp/src/schema-loader.ts`

---

## 1. 背景

ADR-001 §D2 假设 `dws schema --format json` 是 schema-loader 的"权威路径"，未 auth 时降级到 `dws --help` 树解析。该假设来自未 auth 状态下的探测——当时只能看到空 products，无法验证内部结构。

完成 OAuth 后实测发现：**dws 同时维护两套独立 tool 表面**，且二者**不可互相还原**。

---

## 2. 关键事实（实测）

### 2.1 两套表面对照

| 维度 | CLI 表面 (`dws --help` 树) | MCP 表面 (`dws schema --format json`) |
|------|---------------------------|--------------------------------------|
| 工具数 | 82 | **119**（多 ~45） |
| Product 数 | 11 | 12（`bot` 在 schema 是独立 product，CLI 在 `chat` 下） |
| 命名约定 | CLI 路径，kebab-case：`dws aitable record query` | 单一 snake_case 名：`query_records` |
| 参数命名 | kebab-case flag：`--field-ids`、`--executors` | camelCase key：`fieldIds`、`executors` |
| 参数类型描述 | desc 文本启发式（"逗号分隔" / "JSON" 等） | **完整嵌套 JSON Schema**（含 `properties`、`items`、`enum`） |
| 调度方式 | `spawn(dws <path> --flags)` ✅ | 需要 `dws mcp` runtime（**"Reserved canonical runtime surface"**，未发布）❌ |
| 名→路径还原 | 无需还原（自身就是 CLI 路径） | **无机械映射**（`create_personal_todo` 对应 `dws todo task create`） |

### 2.2 不可机械还原的证据

| MCP tool name | 实际 CLI 路径 |
|---------------|--------------|
| `create_personal_todo` | `dws todo task create` |
| `query_records` | `dws aitable record query` |
| `get_user_todos_in_current_org` | `dws todo task list`（推测） |

无前缀、无后缀、无连字符规则可逆。

### 2.3 schema-json 仍**有**的价值

- `aitable.query_records.filters` 在 schema-json 中是完整的 JSON Schema，含 `operands` / `operator` 嵌套结构 + 全部操作符枚举（`eq`/`ne`/`exist`/`contain`/`date_between` 等 19 个）
- help-tree 对同一字段只能描述为 `--filters string` desc=`"过滤条件 JSON"`

---

## 3. 决策

### D1：schema-json 路径下线（stub 化）

`loadFromSchemaJson()` 改为永远返回 `ok([])`，不实际 spawn dws：

```typescript
export async function loadFromSchemaJson(
  _binaryPath: string,
  _timeoutMs = 30_000,
  _spawnImpl: SpawnOnceFn = spawnOnce
): Promise<Result<DwsToolSpec[], DwsError>> {
  return ok([]);
}
```

### D2：loadAll 永远走 help-tree

不再按 `authenticated` 分支。schema-json attempt 始终记录为 `ok: false, reason: "stubbed (see ADR-002): MCP surface != CLI surface"`，便于观察日志理解为何被跳过。

### D3：保留函数名而非删除

理由：
- 公开 API 已被 ARCHITECTURE.md / README 引用
- 留着便于未来 `dws mcp` runtime 发布后改回真实实现
- stub 极廉价（5 行代码 + 一条 `expect spawn not called` 测试守住行为）

### D4：ADR-001 §D2 标记作废

ADR-001 §D2 中"双轨 + 优雅降级"策略被本 ADR 取代为"help-tree 单轨 + bootstrap-only 兜底"。原 §D2 文本保留，标注 superseded by ADR-002。

---

## 4. 不做（明确放弃）

### 4.1 不做 schema-json → CLI 命名映射

理论上可以维护一份 119 行的硬编码映射表（每个 MCP tool name → CLI 路径）。**不做**：
- dws 升级新增 tool 时，映射表会落后
- 违反"零代码维护跟随 dws 升级"的护城河
- 模糊匹配（编辑距离 / 公共子串）实测失败率约 20%（不同抽象层概念，如 `get_user_todos_in_current_org` ↔ `task list`）

### 4.2 不做 schema-json enrichment 层

理论上可以保留 help-tree 作为"骨架"（提供 CLI 路径与 flag 名），用 schema-json 提供"血肉"（嵌套参数 schema）。**不做**：
- 同上，名字映射不可靠
- 即使 80% 命中，剩 20% 退化到启发式 → agent 端见到不一致的两类 tool（有的有详细 schema，有的没有），认知负荷反而更高
- 复杂参数（如 `aitable.filters`）在 dws CLI 端本就接受 JSON 字符串，agent 直接传 JSON 仍能工作；丢失的只是"前置 LLM 端校验"

### 4.3 不期望 dws 修复

dws 双表面是设计而非 bug：
- CLI 表面给人 + 简单 agent 用（`dws ...` 直接 spawn）
- MCP 表面给重型 agent 用（未来通过 `dws mcp` runtime）
- 两套各自演化，不会合并

---

## 5. 影响

### 已修改文件

- `packages/dingtalk-workspace-mcp/src/schema-loader.ts`
  - `loadFromSchemaJson()` → 5 行 stub
  - `loadAll()` 移除 `authenticated` 分支判断
- `packages/dingtalk-workspace-mcp/tests/schema-loader.test.ts`
  - 删除 4 个 schema-json 解析测试
  - 加 1 个 stub 行为守护测试
  - `loadAll` 测试改为只验证 help-tree 路径

### 待回写其他文档

- `docs/decisions/001-param-serialization.md` §D2 加 superseded 注记
- `docs/ARCHITECTURE.md` §3.3 启动流程描述需更新（去掉"先 schema-json 后 help-tree"叙述）
- `docs/HERMES_INTEGRATION.md` 无影响（接入 API 不变）

### 未变

- T1 公开 API（MCP tool list / call 协议）
- 用户接入步骤（`npx -y` + 配置 4 行）
- 性能（schema-json 不再被 spawn，启动反而轻微加快）

---

## 6. 反向验证项（防止悄悄回退）

- 单元测试：`tests/schema-loader.test.ts` 中 "always returns ok([]) regardless of input (no spawn invoked)" 用 `vi.fn()` 守住——任何让 stub 真去 spawn 的改动会令测试失败
- 端到端：`smoke-test.mjs` 输出会显示 `schema-json: skipped (stubbed (see ADR-002)...)`——回退会让该行变化
- 文档：本 ADR 状态为 Accepted。如要"恢复" schema-json 路径，需先开 ADR-003 supersede 002

---

## 7. fixture 留档

`packages/dingtalk-workspace-mcp/tests/fixtures/dws-schema-real.json`（177KB）保留 dws v1.0.8 完整 schema 输出。即使 schema-json 路径下线，未来需要：
- 验证 dws schema 输出格式演进
- 为 ext-long-content 参考嵌套参数语义（如 aitable filters operator 列表）
- 预测 `dws mcp` runtime 发布后能直接转发的 tool 范围

可重新抓取：`dws schema --format json > tests/fixtures/dws-schema-real.json`
