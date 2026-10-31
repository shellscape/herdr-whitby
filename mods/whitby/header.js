// Whitby's agent page header (src/ui/mod.rs agent header): the agent's name, then
// "tool  ·  state" under it, and actions on the right in Whitby's lifecycle style
// (13px icon, 11px label, muted until hovered). The actions are herdr's pane ones.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { panes, terminals, focused, spaces, run, window } from "herdr";
import { palette, icon, lead, paneTitle, tabTitle, childTitle, folder, stateOf, reportOf, STATE } from "./kit.js";

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
  const name = k ? childTitle({ terminal: k }) : tab ? tabTitle(tab) : paneTitle(p);
  const tool = (k ?? p).program?.name || "shell";
  const state = k
    ? k.status ? STATE[stateOf(k.status, k.state === "live", reportOf(k.address))] : folder(k.cwd)
    : p.status ? STATE[stateOf(p.status, true, reportOf(p.terminal))] : folder(p.cwd);
  const several = (tab?.panes ?? 1) > 1;
  return frame
    .child(v_flex().flex_1().min_w(0)
      .child(div().truncate().text_size(15).font_weight(600).text_color(t.foreground).child(name))
      .child(div().mt(4).truncate().text_size(11).text_color(t.muted).child(state ? `${tool}  ·  ${state}` : tool)))
    .child(action(t, "head-split", "mods/pane/split-right.svg", "Split", "pane.split", { direction: "right", pane: p.pane }))
    .when(several, (el) => el.child(action(t, "head-zoom", p.zoomed ? "minimize-2" : "maximize-2", p.zoomed ? "Unzoom" : "Zoom", "pane.zoom", { pane: p.pane })))
    // Closing a shown sub-agent goes back to the pane's own terminal, never closes the parent's pane.
    .child(action(t, "head-close", "x", "Close", k ? "terminal.show" : "pane.close", { pane: p.pane }));
}
