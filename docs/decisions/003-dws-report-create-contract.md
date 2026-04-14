# ADR 003 — dingtalk.report.create 使用契约与 dws CLI 不一致记录

**日期**：2026-04-14
**状态**：Accepted（契约观察，非代码变更）
**研究依据**：dws v1.0.8 (windows/amd64, 31eb109) 实测。真实模板 `1740a771d5107f606dc046d4ffc901f0` ("空白日志") 端到端创建成功（reportId `19d8af36f7f818b7dfdec724072bf808`）。
**关联**：`docs/ARCHITECTURE.md` §6 不做清单、`hermes-extensions/ext-cron-templates/`

---

## 1. 背景

2026-04-15 MCP 工具测试报告中 `dingtalk.report.create` 返回 `SYSTEM_ERROR - business error: success=false`。T1 契约测试已覆盖 `--contents` 的 `json_array` 语义提升，dispatch 也无序列化 bug。直接走 CLI 调用同样 payload **成功**，证明：
- T1 无责（dispatch + parser 正确）
- 钉钉 API 无责（直接调用返回 `success: true`）
- 失败在 **agent 与远程 API 之间的业务契约错配**

本 ADR 记录这个契约，供未来 agent prompt / wrapper 引用。

---

## 2. 关键契约

### 2.1 `contents[].key` 必须精确等于模板 `field_name`

这是钉钉日志 API `create_report` 的硬要求，不是 dws 或 T1 层可见的约束：

```
1. 先查模板：dws report template detail --name <模板名>
   → report_template_fields[].field_name = "内容" / "今日完成" / ...
2. 创建日志：contents[i].key 必须逐字匹配上述 field_name
   错配 → SYSTEM_ERROR success=false（无 CLI 层报错）
```

**反例**（会失败）：模板 field_name 为 `"内容"`，agent 传 `key: "content"` → 业务层拒绝。

**正例**（本次实测通过）：
```json
{
  "template-id": "1740a771d5107f606dc046d4ffc901f0",
  "contents": [{
    "key": "内容",
    "sort": "0",
    "content": "T1 诊断测试",
    "contentType": "markdown",
    "type": "1"
  }]
}
```

### 2.2 `contents[]` 字段规约

| 字段 | 类型 | 说明 |
|------|------|------|
| `key` | string | **精确匹配模板 `field_name`** |
| `sort` | string | 字段顺序（`"0"` 起）。注意是字符串不是 number |
| `content` | string | 正文（markdown / 纯文本，取决于 `contentType`） |
| `contentType` | string | 典型值：`"markdown"` / `"text"` |
| `type` | string | 典型值：`"1"`（文本）；图片/附件字段有其他 type 值，未实测 |

字段映射表（`field_type` → `contentType` / `type`）待后续实测补齐——目前只验证过文本字段（field_type=1）。

### 2.3 dws CLI 自身不一致

**记录但不修复**（T1 不做业务补丁）：

| 操作 | dws flag | 入参含义 |
|------|---------|---------|
| `dws report template list` | 无 | 列出所有模板（返回 `report_template_id` + `report_template_name`） |
| `dws report template detail` | `--name` | **按模板名查** → 返回 `report_template_id` 和 `report_template_fields` |
| `dws report create` | `--template-id` | **按模板 ID 创建** |

**坑**：查详情用 `--name`（名字），创建用 `--template-id`（ID）。两步之间必须手动把 `report_template_id` 从 detail 结果里摘出来。

---

## 3. 决策

### 3.1 T1 层：不做

- T1 是协议翻译层，不做"自动 name → ID 解析"、"自动 field_name 映射"、"contents 校验"——这些都是业务补丁，破坏 host-agnostic（详见 ARCHITECTURE §1.4 反面论证 路径 A/C）。
- 错误原样透传 dws stderr + 钉钉 API 返回，由 agent / 调用方判断。

### 3.2 T2 层：在 prompt 模板里显式声明契约

`hermes-extensions/ext-cron-templates/templates/daily_brief.yaml` 的 system prompt 必须包含：
> "创建日志前，先调 `dingtalk.report.template.detail --name <模板名>` 取得 `report_template_id` 和每个字段的 `field_name`；之后调 `dingtalk.report.create` 时 `contents[].key` 必须逐字等于 `field_name`。"

### 3.3 上游：dws 提 issue

建议上游 dws 在 `report create --help` 文本里加注"`key` 必须精确匹配模板 `field_name`"——这样 help-tree 解析器会自动吸收到 MCP `description` 字段，下游 agent 就不需要 T2 prompt 兜底。

issue 文稿见 `docs/upstream-issues/dws-report-create-contract.md`。

---

## 4. 不做清单

- ❌ 不在 T1 dispatch 里做 contents 字段预校验
- ❌ 不在 T1 里做 `--name` ↔ `--template-id` 的自动翻译
- ❌ 不为此在 T1 增加 tool description 富化（违反 host-agnostic）

---

## 5. 验证参考

- 成功 payload：见 §2.1 正例
- 验证命令：`dws report create --template-id <ID> --contents '[...]' --yes`
- 预期输出：`{ "errorCode": 0, "errorMessage": "ok", "reportId": "...", "success": true }`
