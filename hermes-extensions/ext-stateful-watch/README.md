# ext-stateful-watch

**T2 Hermes extension — v0.2-draft.**

Cron scripts that track DingTalk state across runs so Hermes can alert on things it couldn't notice alone:

| Watcher | Source | Alerts on |
|---|---|---|
| approvals | `dws oa approval list-pending` + `list-initiated` (per configured form) | status transitions, pending > N hours |
| reports | `dws report list` | new report arrivals (delta) |
| todos | `dws todo task list` | todos stale for > N days (age-based) |

All watchers emit markdown to stdout; a Hermes cron prompt template triages the output and decides what to DING / TODO / log.

## Install

```bash
bash install.sh                       # copies into $HERMES_HOME/scripts/stateful_watch/
```

Then manually create a cron job for each watcher you want enabled:

```bash
hermes cronjob create \
  --schedule "*/30 * * * *" \
  --script $HERMES_HOME/scripts/stateful_watch/watch_todos.py \
  --prompt "$(yq -r .prompt $HERMES_HOME/dingtalk-extensions/templates/todos.yaml)"
```

Config at `$HERMES_HOME/dingtalk-extensions/config/stateful_watch.yaml`; state files at `$HERMES_HOME/dingtalk-extensions/state/`.

See `DESIGN.md` for architecture.
