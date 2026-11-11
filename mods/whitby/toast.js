// Whitby's notifications (the layouts' "toast": "whitby"): Herdr's own toast, as it looks, with
// an X to dismiss it. Click the toast to run its action (go to the agent, say) and dismiss it;
// the X only dismisses it. Herdr gives the props: { title, body, level, icon, action, timeout,
// overlay }.

import { div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, theme } from "herdr";
import { icon } from "./kit.js";

const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };

export function toast() {
  const t = theme();
  const p = props() ?? {};
  return h_flex()
    .id("toast")
    .size_full()
    .pl(18)
    .pr(10)
    .gap(12)
    .items_center()
    .bg(t.popover)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click(() => {
      if (p.action?.name) run(p.action.name, p.action.args ?? {});
      closeOverlay(p.overlay);
    })
    .child(p.icon ? image(p.icon).w(18).h(18).flex_none() : div().size(8).rounded(4).flex_none().bg(t[DOT[p.level] ?? "accent"]))
    .child(
      v_flex()
        .flex_1()
        .overflow_hidden()
        .child(div().truncate().font_semibold().text_size(13).text_color(t.foreground).child(p.title ?? ""))
        .when(Boolean(p.body), (el) => el.child(div().truncate().text_size(12).text_color(t.muted).child(p.body ?? ""))),
    )
    .child(
      h_flex()
        .id("toast-dismiss")
        .flex_none()
        .size(24)
        .items_center()
        .justify_center()
        .rounded(3)
        .text_color(t.muted)
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          closeOverlay(p.overlay);
        })
        .child(icon("x", 14)),
    );
}
