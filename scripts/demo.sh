#!/bin/zsh
# Opens a second Herdr window with this layout and a project of demo agents in every
# state, isolated from your own Herdr: its own app home and its own herdr-core session,
# so nothing here touches your spaces, terminals or settings.
#
#   scripts/demo.sh          start the demo (DEMO_SIZE=1023x689 sets the window size,
#                            DEMO_SIDEBAR=256 the sidebar's width)
#   scripts/demo.sh stop     quit it and stop its core
#
# DEMO_DIR picks where it lives (default: $TMPDIR/herdr-whitby-demo). Keep it short:
# Herdr and herdr-core talk over unix sockets inside it.
set -euo pipefail

repo=${0:A:h:h}
dir=${DEMO_DIR:-${TMPDIR:-/tmp}/herdr-whitby-demo}
dir=${dir%/}
demo_env=(
  HERDR_APP_HOME="$dir/app" XDG_CONFIG_HOME="$dir/cfg" XDG_STATE_HOME="$dir/st"
  XDG_RUNTIME_DIR="$dir/rt" HC_SESSION=whitby-demo
  # No update downloads or telemetry from a throwaway window.
  HERDR_RELEASES_URL=http://127.0.0.1:9 HERDR_TELEMETRY=0 DO_NOT_TRACK=1
)
in_demo() { env "${demo_env[@]}" "$@"; }
core_pid() { "$@" hc server status --json 2>/dev/null | sed -n 's/.*"pid":\([0-9]*\).*/\1/p' | tail -1; }

if [[ ${1:-start} == stop ]]; then
  in_demo herdr-app do app.quit >/dev/null 2>&1 || true
  in_demo hc server stop >/dev/null 2>&1 || true
  print "Stopped the demo in $dir."
  exit 0
fi

# Install the layout into the demo's home, opening on it, past the welcome.
mkdir -p "$dir"/{app/layouts,app/themes,app/mods,cfg,st,rt}
chmod 700 "$dir/rt"
cp "$repo"/layouts/whitby.{json,svg} "$dir/app/layouts/"
cp "$repo"/themes/whitby-{light,dark}.json "$dir/app/themes/"
rm -rf "$dir/app/mods/whitby" && cp -R "$repo/mods/whitby" "$dir/app/mods/whitby"
print '{"layout":"whitby","frame.welcomed":"finished"}' > "$dir/app/shared.json"
# This version has run here before, so no "Updated" notice on the first start.
print "{\"last_run\":\"$(herdr-app --version | awk '{print $NF}')\",\"presented\":[]}" > "$dir/app/update-notes.json"
if [[ -n ${DEMO_SIZE:-} ]]; then
  print "{\"state\":\"windowed\",\"bounds\":[120.0,120.0,${DEMO_SIZE%x*}.0,${DEMO_SIZE#*x}.0]}" > "$dir/app/window.json"
fi

in_demo nohup herdr-app >"$dir/app.log" 2>&1 &
for _ in {1..30}; do in_demo herdr-app status >/dev/null 2>&1 && break; sleep 0.5; done

# Never fill your own core with demo agents.
mine=$(core_pid env)
theirs=$(core_pid in_demo)
if [[ -z $theirs || $theirs == "$mine" ]]; then
  print -u2 "The demo's herdr-core isn't separate from yours; not adding agents."
  exit 1
fi

fake=$repo/scripts/fake-agent.sh
tab() { in_demo herdr-app do tab.new "{\"folder\":\"$repo\",$1}" >/dev/null; }
agent() { tab "\"argv\":[\"$fake\",\"$1\",\"$2\",\"$3\"${4:+,\"$4\"}]"; }

in_demo herdr-app do space.new "{\"name\":\"test-project\",\"folder\":\"$repo\",\"argv\":[\"$fake\",\"working\",\"claude-code\",\"Working\"]}" >/dev/null
agent done grok-build "Done (finished while away)"
agent idle codex "Idle"
agent error codex "Error"
agent blocked claude-code "Blocked (approval)" permission
agent blocked muse "Needs you (question)" question
agent blocked grok-build "Needs you (sign-in)" auth
agent blocked muse "Needs you (no reason)"
tab "\"argv\":[\"$repo/scripts/fake-helpers.sh\"]"
tab '"name":"Running (shell)"'
tab '"name":"Running (program)","argv":["sleep","86400"]'
in_demo herdr-app do tab.select '{"index":1}' >/dev/null
[[ -n ${DEMO_SIDEBAR:-} ]] && in_demo herdr-app do layout.resize "{\"id\":\"sidebar\",\"px\":$DEMO_SIDEBAR}" >/dev/null

# Two sub-agents under the first agent, started the way an agent starts one (hc run).
sleep 2
parent=$(in_demo hc ls --json | tr '{' '\n' | sed -n 's/.*"address":"\([^"]*\)".*"where":"test-project \/ 1".*/\1/p' | head -1)
in_demo hc run --bg --no-notify --parent "$parent" --cwd "$repo" -- "$fake" working codex "Working sub-agent" >/dev/null
in_demo hc run --bg --no-notify --parent "$parent" --cwd "$repo" -- "$fake" idle claude-code "Idle sub-agent" >/dev/null

print "Demo running from $dir. Stop it with: scripts/demo.sh stop"
