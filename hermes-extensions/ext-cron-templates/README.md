# ext-cron-templates

**T2 零代码模块**：把经过实测的 Hermes cron prompt 沉淀下来。不是代码包，是 **prompt + 元数据**。

## 现有模板

| 文件 | 用途 | 状态 |
|------|------|------|
| `templates/daily_brief.yaml` | 日报自动草拟 + 钉钉发送（内嵌 `dingtalk.report.create` 契约，见 ADR-003） | v0.1-draft |

## 怎么用

**暂未提供 `install.sh`** — 等 `cron/jobs.py` CLI 入口形态稳定（见 `docs/ARCHITECTURE.md` §4.4 未决分支）再决定是拷贝到 `~/.hermes/cron/templates/` 还是生成一组 `hermes cronjob create` 命令。

**临时手动路径**：`hermes cronjob create --schedule "..." --prompt "$(cat templates/daily_brief.yaml)"`

## 为什么这是 ext 而不是 docs

- 有版本号，随 dws / 钉钉 API 变化迭代
- 是项目官方分发物（`npx ... install-cron-templates` 会拉取）
- 契约（如 ADR-003）在 prompt 里硬编码——这比仓库里的 markdown 更接近 runtime

## 准入原则

新增模板前自问：离开 **Hermes 独家能力** 做不出？（cron + deliver=dingtalk + memory）如果 `dws CLI + 一个 prompt + agent` 能直接搞定，就不加——让用户自己组合。

## 所有模板必须内置的通用契约

2026-04-14 MCP probe 发现 82 tools 里 75 个参数名是 kebab-case（dws 原生），而 LLM 天然偏 camelCase——**不加提示就大概率踩坑**。

每个新模板的 system prompt 开头必须有"参数命名契约"块，见 `templates/daily_brief.yaml` 顶部样板。要点：
1. 参数名用 kebab-case 不转 camelCase
2. 参数描述里的 camelCase 是语义名，不是 key
3. 数组/JSON 参数按各自约定传（见 ADR-001）

这是**唯一非业务**的共享 prompt——其他业务契约（如 ADR-003 的 report.create field_name 匹配）按模板场景自行嵌入。
