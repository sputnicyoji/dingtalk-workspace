#!/usr/bin/env bash
set -euo pipefail

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
SRC="$(cd "$(dirname "$0")" && pwd)"
DST_SCRIPTS="$HERMES_HOME/scripts/stateful_watch"
DST_DATA="$HERMES_HOME/dingtalk-extensions"

mkdir -p "$DST_SCRIPTS" "$DST_DATA/state" "$DST_DATA/config" "$DST_DATA/templates"

rm -rf "$DST_SCRIPTS/lib"
mkdir -p "$DST_SCRIPTS/lib/watchers"
cp -f "$SRC/lib/"*.py "$DST_SCRIPTS/lib/"
cp -f "$SRC/lib/watchers/"*.py "$DST_SCRIPTS/lib/watchers/"
cp -f "$SRC/scripts/"*.py "$DST_SCRIPTS/"
cp -f "$SRC/templates/"*.yaml "$DST_DATA/templates/"

CFG="$DST_DATA/config/stateful_watch.yaml"
if [[ ! -f "$CFG" ]]; then
  cat > "$CFG" <<'YAML'
approvals:
  timeout_hours: 4
  roles_high_priority: ["上级", "客户"]
  initiated_process_codes: []
reports:
  include_senders: []
  exclude_templates: []
todos:
  stale_days: 7
  reminder_interval_days: 3
YAML
  echo "[install] seeded default config at $CFG"
else
  echo "[install] config already exists at $CFG, not overwriting"
fi

cat <<EOF
[install] ext-stateful-watch installed to $DST_SCRIPTS

Next step: create Hermes cron jobs for watchers you want to enable.
Example (todos — recommended first, lowest risk):

  hermes cronjob create \\
    --schedule "*/30 * * * *" \\
    --script $DST_SCRIPTS/watch_todos.py \\
    --prompt "\$(yq -r .prompt $DST_DATA/templates/todos.yaml)"

Same pattern for watch_reports.py / watch_approvals.py.

Edit config: $CFG
State dir (auto-created on first run): $DST_DATA/state/
EOF
