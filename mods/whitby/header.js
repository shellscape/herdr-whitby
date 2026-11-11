// Whitby's agent page header (src/ui/mod.rs agent header): the agent's name, then
// "tool  ·  state" under it (in Whitby Chat, "tool  ·  model  ·  effort  ·  state"), and actions on the right in Whitby's lifecycle style
// (13px icon, 11px label, muted until hovered). The actions are herdr's pane ones.

import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { panes, terminals, focused, spaces, run, window, props, layout, shared, setShared } from "herdr";
import { palette, icon, lead, paneTitle, tabTitle, childTitle, folder, stateOf, reportOf, askingOf, STATE, TERMINAL, MODEL, EFFORT } from "./kit.js";
import { KINDS, kindOf, unlisted } from "./chat-agents.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The pane the header and footer describe: the focused one, else the shown tab's. In
// Whitby Chat with the chat showing, the agent it shows: another pane of its tab (a split)
// can have the keyboard while the chat stays on the agent.
export function current() {
  const all = panes();
  const f = focused();
  const own = f?.pane && all.find((p) => p.pane === f.pane);
  if (own && !kindOf(own) && find(layout(), "agent-view")?.active === "chat") {
    return all.find((p) => p.tab === own.tab && p.pane !== own.pane && kindOf(p)) ?? own;
  }
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
export const focusLine = (t) => (window()?.active !== false && focused()?.terminal ? t.focus : t.border);

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

// Split, as herdr's: a new terminal beside the pane. In Whitby Chat it's also your switch to
// the agent's terminal view (as the view key is), so you see the split you made; the view
// key brings the chat back.
function split(p) {
  run("pane.split", { direction: "right", pane: p.pane });
  if (!props()?.icon || !kindOf(p)) return;
  const list = shared(TERMINAL) ?? [];
  if (!list.includes(p.terminal)) setShared(TERMINAL, [...list, p.terminal]);
  run("layout.select", { stack: "agent-view", child: "main" });
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
    .on_click(() => (typeof command === "function" ? command() : run(command, args)))
    .child(glyph.startsWith("mods/") ? svg(glyph).size(13).flex_none() : icon(glyph, 13))
    .child(div().child(label));
}

export function header() {
  const t = palette();
  const p = current();
  const frame = h_flex().id("whitby-header").size_full().px(20).gap(16).items_center().bg(t.bar).border_b(1).border_color(focusLine(t));
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
  // In Whitby Chat, the model the agent runs and its reasoning effort, as the chat reads them
  // from its session.
  const model = props()?.icon && state ? (shared(MODEL) ?? {})[shown.terminal] : null;
  const effort = props()?.icon && state ? (shared(EFFORT) ?? {})[shown.terminal] : null;
  return frame
    .children(props()?.icon ? agentIcon(t, shown) : [])
    .child(v_flex().flex_1().min_w(0)
      .child(div().truncate().text_size(15).font_weight(600).text_color(t.foreground).child(name))
      .child(div().mt(4).truncate().text_size(11).text_color(t.muted).child(state ? [tool, model, effort && `${effort} effort`, state].filter(Boolean).join("  ·  ") : tool)))
    .child(action(t, "head-split", "mods/pane/split-right.svg", "Split", () => split(p)))
    .when(several, (el) => el.child(action(t, "head-zoom", p.zoomed ? "minimize-2" : "maximize-2", p.zoomed ? "Unzoom" : "Zoom", "pane.zoom", { pane: p.pane })))
    // Closing a shown sub-agent goes back to the pane's own terminal, never closes the parent's pane.
    .child(action(t, "head-close", "x", "Close", k ? "terminal.show" : "pane.close", { pane: p.pane }));
}
