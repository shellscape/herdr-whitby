// Whitby's app rail (src/ui/app_rail.rs): 48px, its buttons at the bottom.
// Add opens a new space (Whitby: add a project); Settings opens herdr's settings.
// Above them, past a line, GitHub's status as its icon (see initRail); a click opens
// githubstatus.com.

import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { run, window, exec } from "herdr";
import { palette, icon, alpha } from "./kit.js";

const FADE = { duration: 150, easing: "ease-out" };

// GitHub's status from githubstatus.com, read at once and then every two minutes, into
// v.github = { level, tip }. The level is "outage" while a component reports a partial or
// major outage; "incident" while an incident is open or a component runs degraded; else
// "normal". It is "unknown" before the first reading and after a failed one.
export function initRail(v, cx) {
  v.github = { level: "unknown", tip: "GitHub: reading status…" };
  const read = (cx) => cx.spawn(async (cx) => {
    try {
      const res = await fetch("https://www.githubstatus.com/api/v2/summary.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      const parts = d.components ?? [];
      const open = (d.incidents ?? []).map((i) => i.name);
      const level = parts.some((c) => c.status === "partial_outage" || c.status === "major_outage") ? "outage"
        : open.length || parts.some((c) => c.status === "degraded_performance") ? "incident" : "normal";
      v.github = { level, tip: `GitHub: ${open.join(" · ") || d.status?.description || "All Systems Operational"}` };
    } catch {
      v.github = { level: "unknown", tip: "GitHub: status couldn't be read" };
    }
    cx.notify();
  });
  read(cx);
  cx.timer.every(120000, read);
}

// Hover state, which drives the fades. It comes from on_hover on a control's outer
// element, which doesn't take the press: on the element that does, a press dragged off
// and released elsewhere never reports the pointer leaving, and the hover sticks.
export function hovered(v, id) {
  return Boolean(v.hovered?.has(id));
}

export function trackHover(el, v, id) {
  return el
    .on_mouse_move((e) => (v.boxes ??= new Map()).set(id, e.bounds))
    .on_hover((on, cx) => {
      v.hovered ??= new Set();
      on ? v.hovered.add(id) : v.hovered.delete(id);
      cx.notify();
      if (on) watchHover(v, id, cx);
    });
}

// A hover can end with no hover-out: Settings opens its own window, and a window at the
// back gets no pointer moves, so the button would stay lit. While it's hovered, a control
// checks every 150ms (as the footer's usage card does) and ends the hover once its window
// goes to the back or the pointer is off it (its bounds from the pointer's last move on it,
// against GPUI's window; the global Herdr's window() hides).
function watchHover(v, id, cx) {
  v.watching ??= new Set();
  if (v.watching.has(id)) return;
  v.watching.add(id);
  const check = (cx) => {
    if (!v.hovered?.has(id)) return v.watching.delete(id);
    const b = v.boxes?.get(id), p = globalThis.window?.mouse_position?.();
    const off = b && p && (p.x < b.x - 1 || p.x > b.x + b.width + 1 || p.y < b.y - 1 || p.y > b.y + b.height + 1);
    if (window()?.active !== false && !off) return cx.timer.after(150, check);
    v.hovered.delete(id);
    v.watching.delete(id);
    cx.notify();
  };
  cx.timer.after(150, check);
}

// A layer that fades in over 150ms while the control is hovered, and out after.
export const fadeLayer = (id, on, child) =>
  div().id(id).absolute().inset(0).opacity(on ? 1 : 0).transition("opacity", FADE).child(child);

// The top layer takes the press. Its fill is GPUI's active style: it shows at once and
// ends when the button is released, wherever that is. Translucent, over the glyph.
export const pressLayer = (id, color, radius, action) =>
  div().id(id).absolute().inset(0).rounded(radius).cursor_pointer().active((s) => s.bg(color))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click(action);

// A tooltip takes the pointer from whatever element it's on, so it goes on a wrapper.
export const withTip = (id, tip, el) => div().id(`${id}-tip`).flex_none().tooltip(tip).child(el);

const centered = (child) => div().size_full().flex().items_center().justify_center().child(child);

// A rail button: 28px, rounded 4, a 1px line, resting on the light or dark surface.
// On hover its fill and its glyph (muted to full) fade in and out over 150ms; while
// it's pressed a fill shows over it at once.
function railButton(v, t, id, glyph, tip, action) {
  const on = hovered(v, id);
  return withTip(id, tip, trackHover(div()
    .id(id)
    .relative()
    .size(28)
    .flex_none()
    .rounded(4)
    .border(1)
    .border_color(t.border)
    .bg(t.bar), v, id)
    .child(fadeLayer(`${id}-fill`, on, div().size_full().rounded(3).bg(t.hover)))
    .child(div().absolute().inset(0).child(centered(icon(glyph, 18, t.muted))))
    .child(fadeLayer(`${id}-ink`, on, centered(icon(glyph, 18, t.foreground))))
    .child(pressLayer(`${id}-press`, alpha(t.foreground, 0.08), 3, action)));
}

// GitHub's icon, in a button's 28px: the text color (black in light) while all is normal,
// amber during an incident, red during an outage, muted while unknown. Its tooltip names
// the open incidents, else GitHub's own summary. A click opens githubstatus.com.
function githubStatus(v, t) {
  const g = v.github ?? { level: "unknown", tip: "GitHub" };
  const color = { normal: t.foreground, incident: t.warn, outage: t.failed }[g.level] ?? t.muted;
  return withTip("rail-github", g.tip, div()
    .id("rail-github")
    .size(28)
    .cursor_pointer()
    .accessibility_label(g.tip)
    .on_click(() => exec("open", ["https://www.githubstatus.com"]))
    .child(centered(icon("github", 20, color))));
}

export function rail(v) {
  const t = palette();
  return v_flex()
    .id("whitby-rail")
    .size_full()
    .py(7)
    .gap(3.5)
    .items_center()
    .bg(t.bar)
    .child(div().flex_1())
    .child(div().my(5.25).child(githubStatus(v, t)))
    .child(div().w(28).h(1).bg(t.border))
    .child(div().my(5.25).child(railButton(v, t, "rail-add", "plus", "New space", () => run("space.new"))))
    .child(div().my(5.25).child(railButton(v, t, "rail-settings", "settings", "Settings", () => run("app.settings"))));
}
