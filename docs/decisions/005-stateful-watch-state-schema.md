# ADR-005 — ext-stateful-watch state schema

**Status**: Accepted (v0.2-draft)
**Date**: 2026-04-14
**Deciders**: Yoji (project owner)
**Supersedes**: None
**Related**: `hermes-extensions/ext-stateful-watch/DESIGN.md` §2

## Context

`ext-stateful-watch` runs three cron-driven watchers over DingTalk data sources that Hermes alone cannot dedup across runs:

- `approvals` — snapshot + diff (status transitions) + timeout detection
- `reports` — append-only set of "already seen" IDs
- `todos` — per-todo stage machine keyed by age

Each watcher runs every 30 min. State must survive restarts, tolerate concurrent writes from retries, and be diagnosable by a human eyeballing the file.

## Decision

**JSONL files, one per watcher, under `$HERMES_HOME/dingtalk-extensions/state/`.**

```
$HERMES_HOME/dingtalk-extensions/
├── state/
│   ├── approvals.jsonl
│   ├── reports.jsonl
│   └── todos.jsonl
├── config/stateful_watch.yaml
└── templates/*.yaml
```

Schema v1 (see §Schema below). No SQLite, no binary format, no cross-watcher shared tables.

## Rejected alternatives

### SQLite
Rejected for v0.2:
- Overkill for append-dominant workloads at < 5MB file sizes
- Adds a runtime dependency beyond stdlib (stdlib has sqlite3 but still adds schema migration complexity)
- Harder to diagnose — can't `tail` or `grep` raw state
- No concurrent-writer benefit: the cron schedule guarantees one writer at a time per watcher

Reconsider in v0.3+ if any state file exceeds 5MB or we add a fourth watcher with fan-out semantics.

### memory_tool (Anthropic API memory tool)
Rejected:
- Session-scoped — state wipes between agent invocations
- Not available before an agent starts (cron script runs before the agent does)
- Couples T2 extension to Anthropic SDK internals, breaking the "any MCP host" promise from CLAUDE.md

### Hermes-native state (plugin API, database)
Rejected:
- No such stable public API in Hermes v0.4.0 as of this writing
- Would couple T2 to Hermes internals; v0.2 aims to keep extensions as plain cron scripts

### One big state file with watcher prefix
Rejected:
- Watchers have fundamentally different record kinds (snapshot vs append vs stage)
- Forced serialization / locking across watchers
- Per-watcher files make rotation and deletion independent

## Schema v1

### approvals.jsonl

Two record kinds, interleaved append:

```jsonl
{"kind":"snapshot","ts":<epoch_s>,"items":[{approval_id,role,status,title,first_seen}]}
{"kind":"alerted","ts":<epoch_s>,"event_id":"<16hex>","source_id":"<approval_id>","detail":"<stage>"}
```

- `snapshot` — one per cron run; current state of all watched approvals.
- `alerted` — one per event emitted; used for timeout dedup.
- `items[].first_seen` — carried forward from prior snapshot if same approval_id, else set to current ts. Enables accurate timeout measurement even when watcher is re-enabled.

Reader treats last `snapshot` row as canonical "prior state" and aggregates `alerted` rows into a set for timeout dedup.

### reports.jsonl

Append-only `seen` rows:

```jsonl
{"report_id":"<hex>","seen_at":<epoch_s>,"creator_user_name":"<redacted>"}
```

Reader loads all `report_id` fields into a set. No compaction in v0.2.

### todos.jsonl

Append-only stage transitions:

```jsonl
{"todo_id":"<taskId>","stage":"first_alert","ts":<epoch_s>,"reminder_count":0,"subject":"<subject>"}
{"todo_id":"<taskId>","stage":"reminded_1","ts":<epoch_s>,"reminder_count":1,"subject":"<subject>"}
{"todo_id":"<taskId>","stage":"closed","ts":<epoch_s>}
```

Reader folds all rows per todo_id, keeping the latest as the current stage. Terminal stage `closed` short-circuits further evaluation.

## Migration path

- **v0.2 → v0.3**: if any file exceeds 5MB, compact by reading all rows, keeping only the latest per key, and writing via `atomic_replace_all` (already implemented in `lib/state.py`).
- **v0.3 → v0.4**: if compacted files still grow unbounded (unlikely for personal-scale use), migrate to SQLite. Write a one-shot migrator that reads JSONL → inserts into SQLite → renames old files to `*.jsonl.bak`.
- **schema bump**: each watcher checks the schema version by peeking at the first row (`schema_version` field, absent in v1 = 1). Mismatch → script exits 1 with a migration hint; no automatic upgrade.

## Out-of-scope (deferred)

- Retention / rotation — v0.2 assumes small files and "delete state dir" is an acceptable reset.
- Encryption — state contains internal IDs and creator names but no credentials or message bodies. Disk ACLs at the OS level are relied upon.
- Cross-machine sync — single-host by design; multi-host users run separate instances with separate state.
- Backup — out of scope; state is derivable from DingTalk history, rebootstrap is cheap (one run re-seeds).

## Consequences

**Positive**:
- Any operator can `cat`, `tail`, or `grep` state files during an incident.
- No migration framework needed until v0.3.
- File-per-watcher isolates blast radius of a corrupt record.

**Negative**:
- No cross-watcher queries ("did I ever alert on approval X and todo Y in the same window?"). Acceptable — that's a triage-layer concern, not a watcher concern.
- Unbounded file growth without compaction. Monitored by the 7-day observation period; if reports.jsonl grows > 100 rows/day we revisit.
- First-run semantics: empty state → all current items emit events (reports first run = spam). Mitigated by narrow lookback window (24h for reports).
