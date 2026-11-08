// Whitby's agent page header (src/ui/mod.rs agent header): the agent's name, then
// "tool  ·  state" under it, and actions on the right in Whitby's lifecycle style
// (13px icon, 11px label, muted until hovered). The actions are herdr's pane ones.

import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { panes, terminals, focused, spaces, run, window, props } from "herdr";
import { palette, icon, lead, paneTitle, tabTitle, childTitle, folder, stateOf, reportOf, askingOf, STATE } from "./kit.js";
import { KINDS, kindOf, unlisted } from "./chat-agents.js";

// The pane the header and footer describe: the focused one, else the shown tab's.
export function current() {
  const all = panes();
  const f = focused();
  const own = f?.pane && all.find((p) => p.pane === f.pane);
  if (own) return own;
  const tab = spaces().find((s) => s.active)?.tabs.find((t) => t.active);
  return tab ? lead(tab, all) : null;
}

// A sub-agent the sidebar shows in that pane in place of its own (terminal.show), else
// null: the header and footer describe it then.
export function shownIn(p) {
  const f = focused();
  return p && f?.shown && f.pane === p.pane ? terminals().find((x) => x.address === f.shown) ?? null : null;
}

// Whitby draws 1px blue lines above and below a focused terminal.
export const focusLine = (t) => (window()?.active !== false && focused()?.terminal ? t.blue : t.border);

// In Whitby Chat (props icon), the agent's icon before its name, at 22px: the one the
// sidebar draws for it (Whitby's own for Claude, Grok and Codex, else herdr's). None
// for a shell.
function agentIcon(t, p) {
  const kind = kindOf(p);
  const prog = p?.program;
  const glyph = kind ? svg(KINDS[kind].glyph).size(22)
    : prog?.agent && prog.icon ? (prog.tint ? svg(prog.icon).size(22) : image(prog.icon).w(22).h(22)) : null;
  return glyph ? [glyph.flex_none().text_color(t.foreground)] : [];
}

function action(t, id, glyph, label, command, args) {
  return h_flex()
    .id(id)
    .flex_none()
    .gap(5.25)
    .items_center()
    .text_size(11)
    .text_color(t.muted)
    .cursor_pointer()
    .hover((s) => s.text_color(t.foreground))
    .on_click(() => run(command, args))
    .child(glyph.startsWith("mods/") ? svg(glyph).size(13).flex_none() : icon(glyph, 13))
    .child(div().child(label));
}

export function header() {
  const t = palette();
  const p = current();
  const frame = h_flex().id("whitby-header").size_full().px(20).gap(16).items_center().bg(t.canvas).border_b(1).border_color(focusLine(t));
  if (!p) return frame;
  const tab = spaces().flatMap((s) => s.tabs).find((x) => x.id === p.tab);
  const k = shownIn(p);
  let name = k ? childTitle({ terminal: k }) : tab ? tabTitle(tab) : paneTitle(p);
  let tool = (k ?? p).program?.name || "shell";
  let state = k
    ? k.status ? STATE[stateOf(k.status, k.state === "live", reportOf(k.address))] : folder(k.cwd)
    : p.status ? STATE[stateOf(p.status, true, reportOf(p.terminal))] : folder(p.cwd);
  const several = (tab?.panes ?? 1) > 1;
  const shown = k ? { terminal: k.address, program: k.program, app: k.agent } : p;
  // In Whitby Chat, an agent still starting is named as itself, not by the shell (or the
  // profile's programs) running before it: "Claude Code  ·  Starting".
  const kind = props()?.icon ? kindOf(shown) : null;
  if (kind && !shown.program?.agent) {
    name = KINDS[kind].title;
    tool = KINDS[kind].title;
    state = askingOf(shown.terminal) ? STATE.needs : "Starting";
  }
  // A tab that has just opened, before anything says what it runs: blank, not "Shell".
  if (props()?.icon && !k && unlisted(p)) { name = ""; tool = ""; state = null; }
  return frame
    .children(props()?.icon ? agentIcon(t, shown) : [])
    .child(v_flex().flex_1().min_w(0)
      .child(div().truncate().text_size(15).font_weight(600).text_color(t.foreground).child(name))
      .child(div().mt(4).truncate().text_size(11).text_color(t.muted).child(state ? `${tool}  ·  ${state}` : tool)))
    .child(action(t, "head-split", "mods/pane/split-right.svg", "Split", "pane.split", { direction: "right", pane: p.pane }))
    .when(several, (el) => el.child(action(t, "head-zoom", p.zoomed ? "minimize-2" : "maximize-2", p.zoomed ? "Unzoom" : "Zoom", "pane.zoom", { pane: p.pane })))
    // Closing a shown sub-agent goes back to the pane's own terminal, never closes the parent's pane.
    .child(action(t, "head-close", "x", "Close", k ? "terminal.show" : "pane.close", { pane: p.pane }));
}
