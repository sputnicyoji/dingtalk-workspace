# Upstream Issue Draft — dws: report create help text 缺少 key 契约提示

**Target**: https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/issues
**Status**: **Filed 2026-04-14 — https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/issues/106**
**关联**：`docs/decisions/003-dws-report-create-contract.md`

---

## 建议的 issue 标题

`[docs] report create --help 未注明 contents[].key 必须精确匹配模板 field_name`

## 建议的 issue body（markdown，直接粘贴）

```markdown
## 背景

`dws report create` 在实际调用时，如果 `contents[].key` 与模板的 `field_name` 不一致，
钉钉 API 会返回 `SYSTEM_ERROR success=false`，但 CLI 层和 help 文本都没有提示这个契约。

对 agent-native 使用（本项目上游对 AI agent 场景的定位）尤为关键——LLM 看到 help
文本 "每项含 key/sort/content/contentType/type" 时，**无法知道 key 必须精确等于
模板侧的 field_name**。

## 复现

1. `dws report template detail --name "空白日志"` → field_name = "内容"
2. `dws report create --template-id <ID> --contents '[{"key":"content","sort":"0","content":"x","contentType":"markdown","type":"1"}]'`
3. 结果：SYSTEM_ERROR（而不是 CLI 层的参数错误）

若改 `key` 为 `"内容"`（逐字匹配 field_name），同 payload 立即成功。

## 建议修改

在 `report create --help` 的 `--contents` 描述里补一句：

> `日志内容 JSON 数组 (必填)，每项含 key/sort/content/contentType/type。**key 必须精确等于模板的 field_name**，可用 \`report template detail --name <模板名>\` 查询。`

以及 Examples 部分加一个完整流水线示例：

```bash
# Step 1: 查模板字段
dws report template detail --name "日报"
# → report_template_id 和 report_template_fields[].field_name

# Step 2: 按 field_name 作为 key 创建
dws report create --template-id <ID> --contents '[{"key":"<field_name>",...}]'
```

## 为什么这个修改重要

- 大量下游通过 `dws --help` 解析生成 MCP tool schema（如 @sputnicyoji/dingtalk-workspace-mcp），
  help 文本的精确度直接决定 agent 调用成功率
- 这个契约对 agent 是**隐形**的——没有任何 CLI 层错误提示会教它修正
- 修改成本极小（只改 help string），收益覆盖全部下游

附带建议（可独立或同 issue 处理）：`report template detail --name` 和
`report create --template-id` 的不一致也可在 help 里点名，避免 agent 误用。
```

---

## 上报方式

选其一：
1. **手动**：复制 body 到 GitHub issue 页面
2. **gh CLI**：
   ```bash
   gh issue create --repo DingTalk-Real-AI/dingtalk-workspace-cli \
     --title "[docs] report create --help 未注明 contents[].key 必须精确匹配模板 field_name" \
     --body "$(cat docs/upstream-issues/dws-report-create-contract.md | sed -n '/^```markdown$/,/^```$/p' | sed '1d;$d')"
   ```
   ⚠️ 上报前确认 body 格式，并检查 dws 仓库是否要求 issue 模板

上报后更新本文件 status 为 `Filed: <issue URL>`。
