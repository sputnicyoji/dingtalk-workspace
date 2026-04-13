# Hermes 集成分析

**最后更新**：2026-04-13
**研究依据**：本机克隆 `D:\Hermes_Agent\`（NousResearch/hermes-agent main）+ 公开文档
**目的**：精确划清 "Hermes 已有什么 / 我们补什么 / 怎么对接"，避免重复造轮子，明确升级风险

---

## 1. Hermes 当前钉钉相关能力（基于源码事实）

### 1.1 钉钉 messaging adapter（已存在）

**位置**：`gateway/platforms/dingtalk.py`
**功能**：通过 DingTalk Stream Mode（长连 WebSocket）做 chatbot 收发消息。**只覆盖聊天 IO，不覆盖业务 API**。

**配置**（`~/.hermes/config.yaml`）：
```yaml
platforms:
  dingtalk:
    enabled: true
    extra:
      client_id: "your-app-key"        # 或 DINGTALK_CLIENT_ID env
      client_secret: "your-secret"     # 或 DINGTALK_CLIENT_SECRET env
```

**依赖**：`pip install dingtalk-stream httpx`，需 DingTalk 企业应用 client_id/secret

**关键事实**：
- 只处理三种 msgtype：`text` / `picture` / `richText`
- 回复走入站消息携带的 `session_webhook` URL（markdown 格式，max 20000 字）
- 自带去重器 `MessageDeduplicator`
- 自动重连退避：`[2, 5, 10, 30, 60]` 秒

**和我们的关系**：
- ✅ **完全覆盖"agent 当作钉钉机器人聊天"** —— **不需要我们重做**
- ❌ **完全不覆盖"调钉钉业务 API"**（待办/日程/AITable/审批/...）—— **这是 T1 的全部价值**

### 1.2 Cron 调度器（已存在）

**位置**：`cron/jobs.py` + `cron/scheduler.py`
**存储**：`~/.hermes/cron/jobs.json`
**输出**：`~/.hermes/cron/output/{job_id}/{timestamp}.md`

**`create_job()` 函数签名**（关键参数）：
```python
create_job(
    prompt: str,            # 触发时跑的自然语言指令（self-contained）
    schedule: str,          # cron 表达式 / "every 5m" 等
    skills: List[str],      # 触发时加载哪些 skill
    deliver: str,           # "origin" / "local" / "telegram" / "dingtalk" 等
    model/provider/base_url, # 按 job 覆盖模型
    script: str,            # 可选 pre-run python script, stdout 注入 prompt
    repeat: int,            # None=永远, 1=单次
)
```

**关键事实**：
- 每次触发是独立 agent run，**无跨周期记忆**
- `deliver="dingtalk"` 直接走 1.1 的 messaging adapter 推消息
- `script` 参数极强大：触发前跑 Python 脚本 → stdout 拼到 prompt 前 → agent 看到"过滤后的事件列表"再决定行动
- skill 加载：`skills` 里指定的 skill 在 prompt 之前注入 system prompt

**和我们的关系**：
- ✅ **完全覆盖"日报/周报/月报"** —— B4 砍掉，改为 `ext-cron-templates`（提供高质量 prompt + schedule）
- ⚠️ **不覆盖"跨周期状态去重"** —— 这是 `ext-stateful-watch` 的存在理由
- 💡 **`script` 参数是 ext-stateful-watch 的最佳接入点**（详见 §3.2）

### 1.3 MCP 客户端（已存在）

**位置**：`tools/mcp_tool.py`（约 1050 行）
**配置块**：`~/.hermes/config.yaml` 下 `mcp_servers:`

**支持能力**：
- stdio transport（`command` + `args`）+ StreamableHTTP transport（`url`）
- 自动重连指数退避（最多 5 次）
- 环境变量过滤（安全）
- 错误信息去敏（凭据剥离）
- 每 server 独立 timeout（默认 120s）+ connect_timeout（默认 60s）
- **Sampling 支持**：MCP server 可反向请求 LLM 完成（带 RPM/token 限额）
- 动态 tool 发现（依赖 MCP SDK ≥ 1.24，处理 `tools/list_changed` 通知）

**这是 T1 接入 Hermes 的唯一通道**——配置就是 4 行 YAML（详见 §2）。

### 1.4 Skills 系统

**目录约定**：
- 项目内置：`hermes-agent/skills/<category>/<name>/SKILL.md`
- 用户级：`~/.hermes/skills/...`
- skill 是 markdown 文件 + 可选附属脚本/数据

**加载方式**：
- 通过 cron job 的 `skills=[...]` 指定
- 通过 `/skills` slash 命令交互式启用
- 通过 `hermes skills` CLI 配置

**和我们的关系**：T2 的 `ext-long-content` 会以 skill 形态发布。

### 1.5 Plugins 系统

**位置**：`plugins/`，目前有 `memory/`、`context_engine/` 两个子系统
**模式**（参考 `plugins/memory/__init__.py`）：
- 扫描 `plugins/<system>/<name>/` 目录
- 每个子目录是一个 provider，含 `__init__.py` 实现某个 ABC（如 `MemoryProvider`）
- 通过 `discover_*()` + `load_*()` 显式加载

**关键限制**：plugins 系统目前**只为 memory provider 和 context engine 设计**，不是通用 tool plugin 机制。**T2 不能假设它能注册 tool**——要走 MCP server 或 cron script 路径。

### 1.6 Delegate / Trajectory Compressor（B5 依赖）

- `tools/delegate_tool.py`：spawn 子 agent，独立 context window，结果回传父 agent
- `trajectory_compressor.py`：长会话压缩器
- `tools/mixture_of_agents_tool.py`：多模型协作

**和我们的关系**：`ext-long-content` 的核心机制——把会议纪要分段交给子 agent 处理，再合并。

---

## 2. T1 接入 Hermes（最终方式确认）

### 2.1 用户侧配置（4 行 YAML）

```yaml
# ~/.hermes/config.yaml
mcp_servers:
  dingtalk:
    command: "npx"
    args: ["-y", "@yoji/dingtalk-workspace-mcp"]
    timeout: 180         # 可选, 默认 120
    connect_timeout: 60  # 可选, 默认 60
```

**前置**：
1. 用户本机 `npm i -g npx` 不需要——Node ≥20 自带
2. 用户本机装 dws：`curl -fsSL https://.../install-dws.sh | sh`
3. 用户跑 `dws auth login` 完成 OAuth device-flow

完成后，Hermes 启动时自动：
- spawn `npx -y @yoji/dingtalk-workspace-mcp`（首次拉包 10-30s，含进度日志走 stderr）
- T1 启动时调 `dws schema` 动态生成 tool list
- Hermes 通过 MCP `tools/list` 拿到全部 `dingtalk.*` tool
- agent 可以直接调用，例如 `dingtalk.todo.task_create({title: "...", executors: [...]})`

### 2.2 T1 代码侧需要保证

- **stdio transport** 优先（v0 唯一支持）；HTTP 留给后续按需
- **支持 env 注入**：Hermes 会传 `env` 字段，T1 用来读 `DINGTALK_MCP_TIMEOUT` 等覆盖项
- **凭据零接触**：T1 不读/不存任何 token，dws 自己管
- **错误消息脱敏**：返回 stderr 时滤掉可能的 token / cookie 模式

### 2.3 已知 Hermes 兼容性事实

- Hermes 对 MCP SDK 版本：≥ 1.24 才有动态 tool 发现；T1 v0 不依赖动态发现（重启即重新 enumerate）
- Hermes 自动从错误消息剥离凭据 → T1 不需要再做一遍但也别添乱
- Hermes 支持 sampling（MCP server 反向请求 LLM）→ **T1 v0 不用**，避免增加复杂度

---

## 3. T2 各 ext 的 Hermes 接入策略

### 3.1 ext-cron-templates 接入（v0.1）

**形态**：纯 yaml + markdown，无运行时代码

**安装**：`npx @yoji/dingtalk-workspace-mcp install-cron-templates` 拷贝到 `~/.hermes/cron/templates/dingtalk/`（路径约定，需要确认 Hermes 是否支持模板目录；如不支持，则改为生成 `hermes cronjob create ...` 的命令脚本）

**模板文件示例**（`daily_brief.yaml`）：
```yaml
name: dingtalk_daily_brief
schedule: "30 8 * * 1-5"
deliver: dingtalk
model: anthropic/claude-haiku-4-5-20251001
prompt: |
  请通过 dingtalk.* 工具：
  1. 拉今日日程 (dingtalk.calendar.today_agenda)
  2. 拉今日待办 (dingtalk.todo.list_pending)
  3. 拉昨日完成的待办（last_24h）
  汇总成中文 markdown 简报，控制在 500 字以内。
```

**用户激活**：参考 README，跑 `hermes cronjob create --from ~/.hermes/cron/templates/dingtalk/daily_brief.yaml`（具体命令以 v0.1 实测为准）

**验证项**：
- [ ] 模板能直接被 `hermes cronjob create` 接受
- [ ] `deliver: dingtalk` 在 messaging adapter 配置完毕的前提下成功推送

### 3.2 ext-stateful-watch 接入（v0.2）—— 关键选型

**痛点回顾**：Hermes cron 单次执行无记忆，"@ 我未回告警" 会每次扫到都推一遍。

#### 三种接入方式对比

| 选项 | 形态 | 优点 | 缺点 |
|------|------|------|------|
| **A. 独立 MCP server** | 第二个 npx -y 包 | host-agnostic、复用 T1 心智模型 | 多一个进程；状态去重和 dws 调用分两套 |
| **B. Hermes plugin** | 进 plugins/ 目录 | 紧密集成 | plugins 系统目前只支持 memory/context engine，要 fork Hermes |
| **C. cron `script` 参数** | Python 脚本，pre-run 注入 prompt | **完美匹配 cron 语义**、零新进程、最小代码量 | Hermes-specific（不是问题，T2 本就 Hermes 专属） |

**推荐 C**。理由：

cron 的 `script` 参数设计上就是 "触发前先跑这段，stdout 注入 prompt"——这是天然的"过滤器"。流程：

```
cron 触发
  ↓
script: dedup_filter.py（属于 ext-stateful-watch）
  - 调 T1 MCP 拉最近 @ 我消息
  - 读 ~/.hermes/dingtalk-extensions/state/unreplied_mentions.jsonl
  - 过滤掉已告警的
  - stdout 输出 "新增未回 @ 列表"
  ↓
prompt 拼接 stdout
  ↓
agent 看到 "你有 N 条新的未回 @ 消息：..."
  ↓
agent 用 dingtalk.* 工具起草回复，推送给我
```

**ext-stateful-watch 真正的代码量** = 一个 Python 脚本（约 100 行）+ 配套 cron job 模板 + state 读写工具。**不需要 plugin 注册、不需要新 MCP server**。

**目录形态**（替代 ARCHITECTURE.md §4.2 中原 plugin 形态）：
```
hermes-extensions/ext-stateful-watch/
├── scripts/
│   └── dedup_filter.py     # cron script 主体
├── lib/
│   ├── state.py            # JSONL 读写
│   └── dws_client.py       # 通过 MCP 调 T1 (可复用 mcp 客户端 lib)
├── templates/
│   └── unreplied_mentions.yaml  # 配套 cron job 模板
├── tests/
├── pyproject.toml          # 安装为 ~/.hermes/dingtalk-extensions/ 下
└── README.md
```

**这一改动需要回写到 `docs/ARCHITECTURE.md` §4.2**——原版本写的是 plugin + dedup_check tool 接口，正确做法是 cron script。

### 3.3 ext-long-content 接入（v0.3）

**形态**：Hermes skill + 配套 helper 模块

**安装位置**：`~/.hermes/skills/dingtalk/meeting_followup/`
- `SKILL.md`：定义触发条件 + 行为
- `pipeline.py`：被 skill 调用的 helper（通过 `subprocess` 跑或者通过 skill 内嵌 python）

**触发方式**（v0.3）：
- on-demand：用户在 Hermes 里说 "处理这次会议的纪要"
- 加载方式：cron job 或 chat 中 `/skills enable dingtalk/meeting_followup`

**v0.3 不做事件触发**——等 Hermes DingTalk adapter 暴露"会议结束"事件类型再做。

**代码侧使用 Hermes 独家能力**：
- 调 `tools/delegate_tool.py` 跑子 agent 做分段总结
- 不直接 import（Hermes 内部 API 不稳定），而是通过 skill 中的 prompt 指示主 agent 调用 `delegate` tool

---

## 4. 依赖矩阵（每个交付物 vs Hermes）

| 交付物 | Hermes 模块依赖 | host-agnostic? | Hermes 升级风险 |
|--------|---------------|---------------|----------------|
| T1 dingtalk-workspace-mcp | `tools/mcp_tool.py` 配置格式 | ✅ 是 | 低（MCP 是公开协议） |
| ext-cron-templates | `cron/jobs.py` 模板格式 | ❌ Hermes only | 中（cron 参数可能演进） |
| ext-stateful-watch | `cron/jobs.py` 的 `script` 参数 | ❌ Hermes only | 中（script 参数稳定性未承诺） |
| ext-long-content | `tools/delegate_tool.py` + skill 加载机制 | ❌ Hermes only | 高（delegate API、skill 路径都可能变） |

**护城河检查**：

- T1 不绑 Hermes，钉钉官方不出 MCP → T1 长期价值稳
- T2 全部 Hermes-specific，Hermes 升级是主要风险 → 每个 ext README 显式声明"经过测试的 Hermes 版本范围"

---

## 5. 兼容性边界与升级风险

### 5.1 Hermes 钉钉 adapter 演进

如果 Hermes 后续给 DingTalk adapter 加了"业务 API 调用"能力（直接调审批/待办），T1 的差异化变窄。**应对**：
- 长期赌的是 dws 的"全产品覆盖" + "OAuth device-flow" + "自己升级"——Hermes adapter 不可能复制这套
- 即便 Hermes adapter 加了部分业务 API，T1 仍是"全覆盖 + 自动同步"的唯一路径

### 5.2 MCP 协议版本

Hermes 用 `mcp` Python 包；T1 用 `@modelcontextprotocol/sdk` TS 包。两边都跟随官方协议演进。
**应对**：T1 在 README 声明支持的 MCP protocol version，半年一次主动测兼容性。

### 5.3 `cron/jobs.py` 的 `script` 参数稳定性

ext-stateful-watch 重度依赖此参数。
**应对**：
- 每个 ext 启动时自检 `script` 参数是否仍被 Hermes 接受（dry-run 一次 cron job 创建）
- 不通过 → 降级到 "tool-based" 模式（注册 dedup_check 为 MCP tool，agent 自行调用）

### 5.4 dws schema 输出格式

T1 启动期硬依赖 `dws schema --format json`。
**应对**：
- 启动期解析 defensive，未知字段 skip + 日志
- 异常时降级到只暴露 `dingtalk.raw_invoke(cmd, args)` 兜底 tool
- 在 README 声明支持的 dws 版本范围

---

## 6. 最终交付物清单（和接入方式对齐）

| # | 交付物 | 形态 | 用户接入命令 | 版本 |
|---|--------|------|------------|------|
| 1 | `@yoji/dingtalk-workspace-mcp` | npm scoped public 包 | 改 `~/.hermes/config.yaml` 加 4 行 + `dws auth login` | v0 |
| 2 | `docs/COMPARISON.md` | 项目文档 | 阅读 | v0.1 |
| 3 | ext-cron-templates 文件包 | `~/.hermes/cron/templates/dingtalk/*.yaml` | `npx @yoji/dingtalk-workspace-mcp install-cron-templates` | v0.1 |
| 4 | ext-stateful-watch | Python 脚本包 + cron 模板 | `pipx install` 或 `pip install --user` 后跑 install 脚本 | v0.2 |
| 5 | ext-long-content | Hermes skill 包 | `npx @yoji/dingtalk-workspace-mcp install-skills` 拷到 `~/.hermes/skills/dingtalk/` | v0.3 |

**Hermes 用户的"完整体验栈"**（v0.3 全部就位后）：

```bash
# 1. 装 dws (一次性)
curl -fsSL https://.../install-dws.sh | sh
dws auth login

# 2. 装 T1 (写到 ~/.hermes/config.yaml mcp_servers.dingtalk)
# 编辑配置，加 4 行

# 3. 装 cron 模板包 (v0.1)
npx @yoji/dingtalk-workspace-mcp install-cron-templates
hermes cronjob create --from ~/.hermes/cron/templates/dingtalk/daily_brief.yaml

# 4. 装状态化告警 (v0.2)
pipx install @yoji/hermes-ext-stateful-watch
yoji-stateful-watch install
hermes cronjob create --from ~/.hermes/dingtalk-extensions/templates/unreplied_mentions.yaml

# 5. 装会议纪要 skill (v0.3)
npx @yoji/dingtalk-workspace-mcp install-skills
hermes skills enable dingtalk/meeting_followup
```

---

## 7. 关键设计修正记录

本文档基于 Hermes 源码深入研究后，对 `ARCHITECTURE.md` 提出以下修正建议（待回写）：

1. **§4.2 ext-stateful-watch 形态**：从 "Hermes plugin 注册 tool" 改为 "cron `script` 过滤器"。Hermes plugins 系统目前只支持 memory/context engine，不是通用 tool plugin。
2. **§4.4 ext-cron-templates 安装路径**：原写"拷到 cron/templates/dingtalk/"，需要在 v0.1 实施时验证 Hermes 是否真的支持这个目录约定，如不支持则改为 "生成 `hermes cronjob create` 命令脚本"。

这些修正会在对应版本动手前同步到 ARCHITECTURE.md。
