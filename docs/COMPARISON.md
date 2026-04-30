# 与现存 DingTalk MCP 实现对比

**截至**：2026-04-14
**对比对象**：npm + GitHub 公开调研，6 个有持续提交的 DingTalk MCP server 项目
**目的**：为本项目（`@sputnicyoji/dingtalk-workspace-mcp`）的差异化定位提供实证基础。理论论证见 [`docs/ARCHITECTURE.md` §1.4](./ARCHITECTURE.md#14-为什么不走其他路径反面论证)。

---

## 一句话结论

现存 6 个项目**全部**手写 tool 定义、手管 OAuth、手追 dws 升级。本项目是**唯一**走"dws CLI 动态解析 + 协议适配"路径的实现，**唯一**做到"dws 升级新增能力时零代码改动自动暴露"。

---

## 对比矩阵

| 维度 | 本项目 | open-dingtalk/dingtalk-mcp | darrenyao/dingtalk-mcp-server | Shawyeok/mcp-dingding-bot | wllcnm/dingding_mcp_v2 | hykfft/mcp-dingtalk-doc | zhaoyunxing92/dingtalk-mcp |
|------|--------|---------------------------|-------------------------------|---------------------------|-----------------------|-----------------------|---------------------------|
| **Tool 总数** | **82**（dws v1.0.8 实测） | ~12 service group | 3 | 2 | 4 | 2 | 5 |
| **覆盖范围** | dws 已覆盖的全部产品（AI 表格 / 日历 / 通讯录 / 群聊 / 待办 / 审批 / 考勤 / 日志 / DING / 工作台 / 文档 ...） | 通讯录 / 部门 / 机器人 / 日历 / 任务 / 打卡 / 工作通知 / 应用 / 服务窗 / 项目 / 日报 / 文化 | 通讯录 + 直发消息 | 群机器人 webhook（文本 / markdown） | 消息 + 日历 + 通讯录 | 钉钉文档解析 | 通讯录 + 企业广播 + 撤回 |
| **Schema 来源** | **`dws --help` 树动态解析** | 手写 + `ACTIVE_PROFILES` 模块开关 | 手写 | 手写 | 手写 | 手写 | 手写 |
| **OAuth / 身份** | **委托给 dws CLI**（`dws auth login`） | 自管 OAuth2 Client ID/Secret | 自管 AppKey/Secret env | 自管 webhook token + HMAC | 自管 AppKey/Secret env | Cookie / Playwright 登录 | 自管 AgentId/Key/Secret |
| **dws 升级跟进** | **零代码改 npm 重装即覆盖** | 手动加 profile + 权限映射 | 手动加 tool | 不适用（仅 webhook） | 手动加 tool | 不适用（仅文档） | 手动加 tool |
| **多 host 通用** | ✅ 标准 MCP，任意 host 可接 | ✅ MCP | ✅ MCP | ✅ MCP | ✅ MCP | ✅ MCP | ✅ MCP |
| **运行时** | Node.js | Java（Spring） | TypeScript | Node.js | Python / Docker | Python + Node | Go |
| **最近活跃** | 持续（v0.0.4，2026-04-14） | 2025-07 | 2025-06 | 2024 | 不详 | 2024 | 2025-04 |

---

## 两个真正分水岭维度

### 1. Schema 来源：手写 vs 动态解析

**所有现存项目都手写 tool 定义。** 即使覆盖最广的 open-dingtalk（~12 服务组）也是按 `ACTIVE_PROFILES` 一份配置一份代码加上去——dws 上次升级（v1.0.7→v1.0.8）新增的命令，他们必须手动写一轮 PR 才能跟上。

**本项目走 dws CLI 解析路径**：启动时跑 `dws --help` 树形遍历，把 cobra 输出反翻成 MCP tool schema（详见 `src/schema-loader.ts` + ADR-002）。dws v1.0.7 时是 80 工具，v1.0.8 自动变 82——**项目方一行代码不用改**。

后果：
- 手写方案：dws 加新命令 → 项目落后 → 用户看不到新能力
- 本项目：dws 加新命令 → `npm install -g` 一次升级即吃到

### 2. 身份域：自建 vs 委托

**所有现存项目都自管 OAuth**——用户要去钉钉开放平台**自己注册一个 ISV 应用**，拿到 AppKey + AppSecret，配进环境变量。每个能力域（考勤 / 日报 / 通讯录 / 审批）都得在钉钉控制台**单独申请权限审批**（多数对个人开发者关闭）。

**本项目委托给 dws CLI**。dws 是钉钉官方 CLI，自带官方 ISV 身份，`dws auth login` 一次 OAuth 即用，权限点跟着 dws 走——用户**完全不需要做钉钉 ISV**。

后果（详见 ARCHITECTURE §1.4 路径 B）：
- 手写方案：用户得有钉钉企业管理员关系 + 开放平台账号 + 各能力域权限审批
- 本项目：装个 CLI、点一次浏览器登录就能用

---

## 该选谁——按场景

| 你的场景 | 推荐 |
|---------|------|
| 想用钉钉**全功能**（考勤 / 日报 / 审批 / AI 表格 / 日历 ...）、不想做钉钉 ISV、想随 dws 升级自动跟版 | **本项目** |
| 已经有钉钉 ISV 身份、能管 OAuth、要深度定制服务窗 / 项目管理这类 dws 还没覆盖的场景 | open-dingtalk（深度优先） |
| 只要个**群机器人 webhook 推消息** | Shawyeok/mcp-dingding-bot（最轻量） |
| 只要解析钉钉**文档** | hykfft/mcp-dingtalk-doc（专一） |

---

## 不挑战的事

本项目**不**做：
- 钉钉 SDK / 自建身份域（这是 dws 的事，详见 §1.4 路径 B）
- 任何 host 专用优化（host-agnostic 是红线，详见 §1）
- dws 还没暴露的产品（等 dws 加 → 自动跟）

也就是说：**dws 覆盖到哪，本项目就到哪**。dws 没覆盖的（如服务窗、特定项目管理 API），open-dingtalk 这类深度手写项目仍有不可替代的价值——这是健康的生态分工，不是零和竞争。

---

## 调研方法与时效

- 数据源：npm 全文搜索 + GitHub 全文搜索 + 钉钉官方文档
- 样本：6 个有持续提交的项目（不含废弃 / 单次 demo / 内部 fork）
- 工具数与覆盖范围以**项目 README + 源码**为准，未做端到端运行验证
- dws 自身工具数随版本变化，本文以 v1.0.8 实测的 82 为基准

如发现遗漏的项目或本文事实错误，欢迎提 PR 修订对比矩阵。
