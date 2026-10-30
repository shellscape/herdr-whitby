#!/bin/zsh
# A stand-in agent that also reports helpers of its own, the way Claude Code reports
# its subagents: OSC 7501 records, each with an id (titles are base64).
b() { printf '%s' "$1" | base64; }
printf '\e]2;%s\a' "Working, with helpers"
print "Demo agent: it reports three helpers to Herdr and nothing else runs here."
while true; do
  printf '\e]7501;state=working:app=claude-code\a'
  printf '\e]7501;id=h1:state=working:app=claude-code:title=%s\a' "$(b 'Working helper')"
  printf '\e]7501;id=h2:state=idle:app=claude-code:title=%s\a' "$(b 'Idle helper')"
  printf '\e]7501;id=h3:state=done:app=claude-code:title=%s\a' "$(b 'Stopped helper')"
  sleep 5
done
