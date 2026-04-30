# ext-stateful-watch — Design

## §1 Architecture & packaging

Single ext, three watcher modules sharing one base. Each watcher is a `scripts/watch_*.py` entrypoint that the Hermes cron calls on a schedule; the script writes markdown to stdout which the cron prompt template triages.

```
┌─── scripts/watch_approvals.py ─┐
├─── scripts/watch_reports.py  ──┤ stdout (markdown)
└─── scripts/watch_todos.py    ──┘      │
                │                       ▼
                │              Hermes cron prompt
                ▼                       │
  lib/watchers/*.py (pure diff)         ▼
                │            agent triages → DING / TODO / log
                ▼
  lib/state.py  lib/dws_client.py  lib/config.py
                │
                ▼
  ~/.hermes/dingtalk-extensions/{state,config,templates}/
```

Not three separate exts — CLAUDE.md forbids inter-ext deps; all three live in one package so shared base is allowed. Users enable individual watchers by creating only the cron jobs they want.

## §2 State schema per watcher

All state files are JSONL under `$HERMES_HOME/dingtalk-extensions/state/`.

### approvals (`approvals.jsonl`)

Two record kinds:

```jsonl
{"kind":"snapshot","ts":<epoch>,"items":[{approval_id,role,status,first_seen,title,...}]}
{"kind":"alerted","ts":<epoch>,"event_id":"<16hex>","source_id":"<approval_id>"}
```

- Each run appends one `snapshot` (compact list of current pending + configured-initiated items).
- Diff between the last two snapshots yields status-transition events.
- Per-item `first_seen` carries forward so timeout detection stays accurate across runs.
- `alerted` rows suppress duplicate timeout alerts for the same approval.

### reports (`reports.jsonl`) — append-only

```jsonl
{"report_id":"...","seen_at":<epoch>,"creator_user_name":"..."}
```

New run fetches current list; `report_id ∉ seen_set` → emit event + append row.

### todos (`todos.jsonl`) — stage machine

```jsonl
{"todo_id":"...","stage":"first_alert","ts":<epoch>,"created_time":<epoch>}
{"todo_id":"...","stage":"reminded_1","ts":<epoch>,"created_time":<epoch>}
{"todo_id":"...","stage":"closed","ts":<epoch>}
```

Age-based (not deadline-based — real data has `dueTime: null`):
- `first_alert`: emitted when `now - created_time >= stale_days * 86400` and no prior alert row.
- `reminded_N`: every `reminder_interval_days` thereafter, counter `N` increments.
- `closed`: emitted once when todo disappears from active list or `finalStatusStage != 2`; terminal.

### Common rules

- `os.replace` for atomic snapshots rewrites (watch_approvals compacting); append for everything else.
- Corrupt line tolerance: `json.loads` failure → skip + stderr warn, do not abort.
- Size rotation out-of-scope v0.2; migrate threshold documented in ADR-005.

## §3 Delivery via stdout + agent triage

Watchers emit events to stdout, they **never** call `dws ding` or `dws chat message send` themselves. Rationale:
1. Triage (severity routing, quiet hours, grouping) benefits from LLM reasoning, not hardcoded rules.
2. Every alert is logged in cron output — auditable.
3. dws failures in the watcher don't pollute state with false "alerted" rows.

Output format (markdown):

```
# stateful-watch / <watcher>

- [<severity>] <kind>:<source_id> — <title> — <detail>
- [<severity>] ...
```

Empty output on no new events or dws failure (script exits 0 either way — cron resilience).

Severity values: `info`, `warn`, `alert`. Templates map these to actions.

## §4 Testing strategy

| Layer | Tool | Targets |
|---|---|---|
| Unit (pure) | pytest | `lib/watchers/*.py` diff/filter/stage functions |
| I/O | pytest + tmp_path | `lib/state.py` append, load, atomic replace, corrupt-line tolerance |
| Wrapper | pytest + fake runner | `lib/dws_client.py` success/failure/bad-json paths |
| E2E | pytest + monkeypatch HOME + fake runner | `scripts/watch_*.py` first-run + second-run integration |

Not tested automatically:
- Real dws calls — done manually in Task 16 spot-check.
- Hermes cron integration — 7-day observation period after merge.

## §5 Rollout / exit criteria

- **v0.2.0-draft**: all 16 plan tasks committed + `pytest` green + install.sh dry-run works.
- **Observation week**: enable γ-todos first (pure read, lowest risk). Monitor state file growth, correctness of stage transitions, cron log noise.
- **Stable v0.2.0**: bump after at least one watcher has 7 days of clean runs. Other two watchers enabled per user appetite.
- **Rollback**: `rm -rf $HERMES_HOME/scripts/stateful_watch/ $HERMES_HOME/dingtalk-extensions/state/` — no further traces.

## §6 Data shapes (captured in Task 1 probe, fixtures/)

### `dws report list` (real data)
Top level: `{errcode, errorMsg, result: {hasMore, nextCursor, report_list: [...]}}`

Item fields:
- `report_id` (str, unique)
- `create_time` (epoch ms)
- `modified_time` (epoch ms)
- `creator_user_id` (str)
- `creator_user_name` (str)

**No title / template / content** — triage agent must call `dws report detail --report-id <id>` if it wants more.

### `dws todo task list` (real data)
Top level: `{result: {todoCards: [...]}}`

Item fields:
- `taskId` (str)
- `subject` (str, observed values: "审批系统", "测试待办创建")
- `createdTime` (epoch ms)
- `dueTime` (**always null in observed data**)
- `finalStatusStage` (int, all observed = 2)
- `priority` (int, observed 20/40)

Observed anomaly: `--status false` returns empty while `--status true` and default return same populated list. Interpret `finalStatusStage == 2` as "active" in this dataset; will revisit if finalStatusStage changes in practice.

### `dws oa approval list-pending` (empty at probe time)
Top level: `{result: {hasMore, processInstanceList: [], totalCount}, success}`

Item shape unknown — tests use fabricated fields (`processInstanceId`, `title`, `originatorUserName`, `createTime`, `status`) per DingTalk API conventions. **Patch on first live run** once real items arrive.

### `dws oa approval list-initiated`
Requires `--process-code <form-id>`. Mock-mode returns empty `result: []`. Real shape not captured — watcher iterates `config.approvals.initiated_process_codes` and makes one call per code. First call with real data will reveal item shape; tests currently use the same fabricated shape as pending.

## Open items for next probe

- Item shape of pending/initiated approvals (need real data)
- Whether `finalStatusStage` has values other than 2 in the wild
- Whether report sender patterns let us filter by department (currently only `creator_user_id`/`creator_user_name` available)
