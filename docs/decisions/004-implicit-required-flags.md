# ADR 004 — dws CLI 隐式 required flag 清单

**日期**：2026-04-14
**状态**：Accepted（契约观察 + prompt 兜底，非代码变更）
**研究依据**：dws v1.0.8 (windows/amd64) MCP 端到端测试。
**关联**：`docs/decisions/003-dws-report-create-contract.md`、`docs/upstream-issues/`、`legacy/hermes-extensions/ext-cron-templates/`（已归档）

---

## 1. 背景

T1 的 schema 标 required 完全依赖 dws `--help` 文本里的 `(必填)` / `(required)` 标记。但 dws 的 help 文本质量参差——**多个 flag 在 API 层是必填的，但 help 没标**。结果：

- T1 schema：`required: []`
- agent 调用：直接传部分参数
- dws CLI：返回 `validation: "--xxx is required"`
- agent：必须重试一次才能成功

**T1 没法在协议层修复**（修了就是把"哪个 flag 必填"这种业务知识塞进协议适配器，破坏 host-agnostic，详见 ARCHITECTURE §1.4 路径 A 退化论证）。

正确路径：
1. **运行时兜底**（路径 C）：dws 自己会报 validation 错——协议穿透即可
2. **prompt 契约**（路径 B）：在 ext-cron-templates 的共享 prompt 里枚举已知"隐式 required"，让 agent 第一次就传对，省一次往返

本 ADR 是路径 B 的清单源。

---

## 2. 已知隐式 required 清单（dws v1.0.8）

来源：2026-04-14 端到端测试报告。

| Tool | Flag | Help 标记 | 实际 API | 验证证据 |
|------|------|-----------|---------|---------|
| `dingtalk.chat.message.send-by-bot` | `robot-code` | 无 | 必填 | dws stderr: `--robot-code is required` |
| `dingtalk.chat.message.send-by-bot` | `title` | 无 | 必填 | dws stderr: `--title is required`（即使传了 robot-code + users + text 仍报） |
| `dingtalk.oa.approval.list-initiated` | `process-code` | 无 | **必填**（实测确认） | 不传 → "参数错误"；传 dummy 值 → "success=false"（错误形态变化证明 process-code 通过了缺参检查） |

**待补**（下次端到端测试发现新条目时追加）：
- ...

## 3. 决策

### 3.1 T1 层：不动

不在 `src/schema-loader.ts` 或任何代码里维护 override 表。任何"具体哪个 tool 的哪个 flag 必填"都是业务事实清单，不属于解析规则。

### 3.2 ext-cron-templates：在共享 prompt 里枚举

`templates/daily_brief.yaml`（及未来所有模板）的"参数命名契约"块下方追加"已知隐式 required"小节，列出本 ADR §2 的清单。

agent 看到 prompt 后：
- 第一次调用 `chat.send-by-bot` 就会带 `robot-code`
- 第一次调用 `oa.list-initiated` 就会带 `process-code`

省一次往返，不污染 T1。

### 3.3 上游：合并到 dws issue

把本 ADR §2 清单作为 dws issue #106 的后续追加（或独立新 issue），建议 dws 在 help 文本里给这些 flag 加 `(必填)` 标记。修好后本 ADR 对应行可删除（清单缩短）。

---

## 4. 不做清单

- ❌ T1 src/ 内任何 override / patch / fixup 表
- ❌ T1 dispatch 内任何"传参前预校验"逻辑（运行时 dws 已自检）
- ❌ 在 ADR 里枚举 dws 已正确标记的 required flag（只列上游缺失的）

---

## 5. 维护节奏

每次 MCP 端到端测试发现新的"隐式 required"案例 → 追加到 §2 清单 → 同步更新 `templates/daily_brief.yaml` 的提示块 → 评估是否值得追到 dws issue。

dws 如果修了 help 文本，对应行从 §2 删除（避免 prompt 冗余）。
