# Upstream Issue Draft — dws: 多个 flag 在 API 必填但 help 未标 (必填)

**Target**: https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/issues
**Status**: 待上报（2026-04-14 拟稿，可与 #106 合并或独立）
**关联**：`docs/decisions/004-implicit-required-flags.md`

---

## 建议的 issue 标题

`[help] 多个命令的 flag 在 API 层必填但 --help 未标 (必填)`

## 建议的 issue body

```markdown
## 背景

接 #106 同款问题：dws --help 文本是下游工具（含基于 help 解析自动生成 MCP schema 的 wrapper）的真理之源。本 issue 列出一组 **API 必填但 help 未标 (必填)** 的 flag。

下游影响：MCP wrapper 把 required 映射成 schema，schema 不全则 LLM 第一次调用必失败一次；用户体验和 token 都浪费一次往返。

## 实测清单（dws v1.0.8）

| 命令 | flag | 现 help | 失败现象 |
|------|------|---------|---------|
| `dws chat message send-by-bot` | `--robot-code` | `--robot-code string  机器人 Code`（无 (必填)） | dws stderr: `--robot-code is required` |
| `dws oa approval list-initiated` | `--process-code` | `--process-code string  processCode`（无 (必填)） | API 返回 `business error: 参数错误`，仅传 start/end 不行 |

（如有他人发现新条目欢迎追加）

## 建议修改

每个上面的 flag，help 描述追加 `(必填)` 或 `(required)`，与现有同类标记一致。

## 为什么这件事划算

- 改动局限于 cobra 命令注册的 description 字符串（多数情况 1 行字面量）
- 修一次受益所有下游：MCP wrapper / 文档 / shell 自动补全 / IDE 插件
- 替代方案（让每个下游自己维护 override 表）会形成知识碎片，且每次 dws 升级各自维护负担
```

---

## 上报方式

```bash
gh issue create --repo DingTalk-Real-AI/dingtalk-workspace-cli \
  --title "[help] 多个命令的 flag 在 API 层必填但 --help 未标 (必填)" \
  --body-file <(sed -n '/^```markdown$/,/^```$/p' docs/upstream-issues/dws-implicit-required-flags.md | sed '1d;$d')
```

上报后更新本文件 status 为 `Filed: <issue URL>`。
