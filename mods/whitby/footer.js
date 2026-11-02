// Whitby's agent footer (src/ui/terminal_view.rs live footer): 42px, key hints and the
// agent's plan usage on the left; the process title, sub-agents and its state on the right.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { terminals } from "herdr";
import { palette, keyFor, subCount, stateOf, reportOf, STATE } from "./kit.js";
import { current, shownIn, focusLine } from "./header.js";
import { statusMark } from "./sidebar.js";
import { usage, providerOf, syncCard } from "./usage.js";

// The agent's activity, with the sidebar's dot ("Working", "Needs you", ...).
function activity(t, status, address, live) {
  if (!status) return null;
  const state = stateOf(status, live, reportOf(address));
  return h_flex().flex_none().mr(12).gap(5).items_center().text_color(t.word[state] ?? t.footerMuted)
    .child(statusMark(t, state))
    .child(div().child(STATE[state]));
}

export function footer(v) {
  const t = palette();
  const p = current();
  // A shown sub-agent (see shownIn), else the pane's own terminal.
  const k = shownIn(p);
  const address = k ? k.address : p?.terminal;
  const status = k ? k.status : p?.status;
  const live = k ? k.state === "live" : true;
  const width = v.size?.width ?? 1000;
  const hint = (command, label) => {
    const key = keyFor(command);
    return key ? h_flex().flex_none().gap(4).items_center().child(div().child(key)).child(div().child(label)) : null;
  };
  const hints = [hint("agent.prev", "Prev"), hint("agent.next", "Next")].filter(Boolean);
  const subs = subCount(address, terminals());
  const stat = v.stats?.[address];
  const process = status ? (k ?? p).program?.name : (k ?? p)?.title;
  // Only the agent in view shows its account's usage.
  const provider = providerOf(k ?? p);
  syncCard(v, provider ? `${provider}:${address}` : null);
  return h_flex()
    .id("whitby-footer")
    .size_full()
    .px(16)
    .items_center()
    .bg(t.footer)
    .border_t(1)
    .border_color(focusLine(t))
    .text_size(11)
    .text_color(t.footerMuted)
    .on_size_change((size, cx) => { v.size = size; cx.notify(); })
    .child(h_flex().flex_none().gap(width < 500 ? 6 : 16).items_center().children([...hints, ...(provider ? [usage(t, provider, v.usage[provider], v.sessions?.[address], v)] : [])]))
    .child(div().flex_1().min_w(0))
    // The process title: an agent's tool ("Codex", as Solo shows it), a shell's own title.
    .when(Boolean(process) && width >= 500, (el) => el.child(div().mr(12).max_w(180).min_w(0).truncate().child(process)))
    .when(subs > 0, (el) => el.child(div().flex_none().mr(12).child(`+${subs} ${subs === 1 ? "sub-agent" : "sub-agents"}`)))
    // Whitby shows CPU and memory only where the pane is at least 700px wide.
    .when(Boolean(stat) && width >= 700, (el) => el
      .child(div().flex_none().mr(12).child(`CPU ${stat.cpu.toFixed(1)}%`))
      .child(div().flex_none().mr(12).child(`MEM ${Math.round(stat.mem / 1000000)} MB`)))
    .when(Boolean(status), (el) => el.child(activity(t, status, address, live)))
    // One state at a time: an agent's own, else a live terminal's "Running".
    .when(Boolean(address) && !status && live, (el) => el.child(h_flex().flex_none().gap(5).items_center().text_color(t.live)
      .child(statusMark(t, "running"))
      .child(div().child("Running"))));
}
