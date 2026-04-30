# ADR 001 — dws 参数序列化与 schema 发现

**日期**：2026-04-13
**状态**：Accepted
**研究依据**：本机 dws v1.0.8 (windows/amd64), commit 31eb109, "MCP Dynamic Aggregation" architecture
**研究范围**：未 auth 状态下 `dws --help` 树形遍历 + 关键 leaf 命令实测
**关联文档**：`docs/ARCHITECTURE.md` §3.3, §3.4

---

## 1. 背景

T1 dispatch 层需要把 MCP `tools/call` 的 JSON arguments 转成 dws CLI flags。`docs/ARCHITECTURE.md` §3.4 列了 4 种参数类型映射假设（string/number 直传、boolean 开关、array 重复 flag 或逗号、object JSON 字符串），但**所有这些都是推测**，需要实测确认。同时 `docs/ARCHITECTURE.md` §3.3 假定启动时调 `dws schema --format json` 获取结构化 schema——这条也需要验证。

本文档记录实测结果，**取代**所有上述推测。

---

## 2. 关键事实（实测）

### 2.1 dws v1.0.8 的参数模式

dws 所有 leaf 命令的 flag **只用三种基本类型**：`string` / `int` / `bool`。

复杂类型通过两种约定承载：

| 复杂类型 | dws 表示 | 实测样本 |
|---------|---------|---------|
| **基本类型数组**（list of string/int） | **逗号分隔字符串** | `--executors userId1,userId2`<br>`--field-ids id1,id2,id3`<br>`--record-ids r1,r2` |
| **嵌套对象 / 对象数组** | **JSON 字符串塞进单 flag** | `--filters '[{...}]'` (desc: "过滤条件 JSON")<br>`--sort '[{...}]'` (desc: "排序 JSON 数组") |
| **枚举** | **string，可选值在 desc 里** | `--priority` desc: `10=low/20=normal/30=high/40=urgent` |
| **日期时间** | **ISO-8601 string** | `--due "2026-03-10T18:00:00+08:00"` |
| **必填标记** | desc 后缀 `(required)` 或 `(必填)` | `--title string Todo title (required)`<br>`--table-id string Table ID (必填)` |

**没有发现**：
- ❌ `--key v1 --key v2` 重复 flag 模式
- ❌ `--key-json` 这种"专用 JSON 字段"的命名后缀
- ❌ 嵌套子命令需要 stdin 传 JSON 的情况

### 2.2 dws schema 命令的认证依赖

- `dws schema` **空 products**（auth=false 时）：返回 `{"count": 0, "kind": "schema", "products": []}`
- `dws --help`、`dws <service> --help`、`dws <service> <command> --help` **都不需要 auth**
- `dws auth status` 不需要 auth 即可查询

**根因**："Architecture: MCP Dynamic Aggregation" 设计——产品在 OAuth scope 确定后才"发现"，未 auth 时聚合层为空。这是 dws 的安全设计，不是 bug。

### 2.3 dws mcp 子命令现状

- 存在 `dws mcp` 命令，提示语：`"Reserved canonical runtime surface. Tools are generated from the shared Tool IR under dws mcp."` `"No canonical products are currently loaded. Set DWS_CATALOG_FIXTURE to populate the surface."`
- 当前是**保留接口**，无开箱即用 MCP server
- 这**确认了** T1 项目长期价值：钉钉官方走 CLI + MCP 广场路径，不会出官方 MCP server 让我们的 wrapper 归零

---

## 3. 决策

### D1：参数序列化规则（dispatch.ts）

T1 把 MCP arguments → dws CLI flags 时按以下顺序判断：

```typescript
function flagify(key: string, value: unknown, fieldHint?: string): string[] {
  // 规则 1: undefined/null → skip
  if (value == null) return [];

  // 规则 2: boolean → switch flag (true 加 flag, false 不加)
  if (typeof value === 'boolean') return value ? [`--${key}`] : [];

  // 规则 3: 基本类型 → 直接 stringify
  if (typeof value === 'string' || typeof value === 'number') {
    return [`--${key}`, String(value)];
  }

  // 规则 4: array 分两种
  if (Array.isArray(value)) {
    // 4a: 元素都是基本类型 → 逗号分隔字符串
    if (value.every(v => typeof v === 'string' || typeof v === 'number')) {
      return [`--${key}`, value.join(',')];
    }
    // 4b: 元素含对象 → JSON 字符串
    return [`--${key}`, JSON.stringify(value)];
  }

  // 规则 5: object → JSON 字符串
  if (typeof value === 'object') {
    return [`--${key}`, JSON.stringify(value)];
  }

  throw new Error(`Unsupported value type for --${key}: ${typeof value}`);
}
```

**`fieldHint` 参数为预留**：未来如需根据 dws schema 的 description 字段做更精细判断（例如 description 含 "JSON"），可挂在这里。v0 不用。

### D2：Schema 发现策略 —— 双轨 + 优雅降级

> **⚠ Superseded by [ADR-002](002-dws-dual-tool-surfaces.md) (2026-04-13)**
>
> Auth 后实测发现 `dws schema --format json` 暴露的是与 CLI 不同的 MCP 表面，
> 名字无法机械还原成 CLI 路径。下方"双轨"策略实际从未真正命中 schema-json 路径（除空 products 退化情况）。
> 现行实现：help-tree 单轨 + bootstrap-only 兜底。本节文字保留作为历史记录。


T1 启动时按以下顺序尝试：

1. **优先：`dws schema --format json`** —— auth 后返回完整 JSON Schema
2. **降级：`dws --help` 树形遍历 + 文本解析** —— auth 前也能用，提供基础工具列表
3. **彻底失败：`dws.bootstrap` 单 tool** —— 引导用户先 `dws auth login`

**降级时每个 tool 的 inputSchema 由文本解析填充**：
- 提取 `Available Commands:` → 子服务列表
- 提取 `Flags:` 段 → 每个 flag 解析 `--key type description (required?)`
- type 字段：`string` → JSON Schema `{type: "string"}`，`int` → `{type: "integer"}`，`bool` → `{type: "boolean"}`
- description 末尾 `(required)` 或 `(必填)` → 加入 `required` 数组
- description 含关键词 "JSON"/"JSON 数组" → inputSchema type 升级为 `{type: "array"}` 或 `{type: "object"}`，运行时 dispatch 自动 JSON.stringify
- description 含 "逗号分隔"/"comma-separated" → inputSchema type 升级为 `{type: "array", items: {type: "string"}}`，dispatch 自动 join(',')

**这意味着 §2.1 的"约定"在 inputSchema 里被显式还原**，agent 看到的是符合 JSON Schema 习惯的类型，不会被迫手写逗号字符串或 JSON 字符串。

### D3：放弃 ARCHITECTURE.md §3.4 的 array 描述

原文："array: --key v1 --key v2 (重复) 或 --key v1,v2 (dws 惯例待验证)"——实测确认**只用逗号分隔**，重复 flag 模式不存在。

**待回写 ARCHITECTURE.md §3.4**：把 array 行改为 "array of primitives: 逗号分隔；array of objects: JSON 字符串"。

### D4：放弃"object 用 --key-json"假设

原文："object: --key-json '{...}' (需 dws 支持, 启动时探测)"——实测 dws 直接用普通 flag 名（如 `--filters`），值为 JSON 字符串，**无 -json 后缀**。

**待回写 ARCHITECTURE.md §3.4**：把 object 行改为 "object: 该 flag 值为 JSON 字符串（dws desc 含 'JSON' 关键词）"。

---

## 4. 待解决问题（不阻塞 v0 编码）

### Q1：array of objects 的解析

D1 中 4b 把 array of objects 整个 JSON.stringify。但实际 dws 命令里**没看到** array of objects 形态的参数（因为 dws 把 `--filters` 这种"对象数组"用了 string 类型 + JSON desc 描述）。

**应对**：保留 D1 中的 4b 分支兜底，但**可能永远不会触发**。Yoji auth 后再实测。

### Q2：未来 dws v2.0 schema 格式变化

如果 dws v2 改变 schema 输出 JSON 结构，schema-loader 会报错。

**应对**：
- T1 启动时检查 `dws --version` 是否 ≥ 已声明 minVersion
- schema 解析全程 try/catch，遇未知字段记日志、跳过
- 任何解析失败 → 自动降级到"`--help` 树遍历"，不让 server 崩溃

### Q3：dws 内嵌 MCP（`dws mcp` + DWS_CATALOG_FIXTURE）启用后

如果未来 dws 通过 `DWS_CATALOG_FIXTURE` 或类似机制提供 stdio MCP server，T1 可能可以**直接转发**而不是模拟，进一步降低维护成本。

**应对**：v1.0+ 再评估，留观察。

---

## 5. 对 ARCHITECTURE.md 的回写清单

下次修改 ARCHITECTURE.md 时同步：

- [ ] §3.3 启动流程：说明 schema-loader 的双轨策略（schema → help-tree → bootstrap-tool）
- [ ] §3.4 dispatch 规则：array 只用逗号分隔（删除"重复 flag"备选），object 不用 -json 后缀
- [ ] §5.2 dws schema 稳定性：补充"schema 命令本身依赖 auth"这一事实

---

## 6. 实测命令记录（可复现）

```bash
export PATH="$HOME/.local/bin:$PATH"

# 基础探测
dws version
dws --help
dws auth status

# Schema 命令（auth-gated）
dws schema
dws schema --jq '.products[] | {id, tool_count: (.tools | length)}'

# 复杂 leaf 命令 help 探测
dws aitable record query --help        # filters / sort 是 JSON, 数组 ID 是逗号分隔
dws calendar event create --help       # 仅 title/start/end/desc, 无 attendees
dws todo task create --help            # executors 逗号分隔, due ISO-8601, priority 枚举

# 内嵌 MCP 接口（保留态）
dws mcp --help
```

`dws --version` 输出：
```
Version:        v1.0.8
Edition:        open
Build:          2026-04-07T12:33:43Z
Commit:         31eb109
Architecture:   MCP Dynamic Aggregation
Go:             1.24+
```
