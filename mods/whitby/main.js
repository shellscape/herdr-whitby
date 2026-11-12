// Whitby: herdr dressed as the Whitby desktop app. One mod draws each part of
// the layout, picked by props().part: titlebar, rail, sidebar, header, footer, home, and
// the footer's usage card (usage-card); and the Whitby Chat layout's chat. It also draws the
// layouts' notifications (their "toast": "whitby"), which come with a toast's props, no part.

import { View, div } from "gpui-kit";
import { props } from "herdr";
import { titlebar } from "./titlebar.js";
import { initRail, rail } from "./rail.js";
import { initSidebar, sidebar } from "./sidebar.js";
import { header } from "./header.js";
import { footer } from "./footer.js";
import { initHome, home } from "./home.js";
import { sampleStats } from "./kit.js";
import { initUsage, usageCard } from "./usage.js";
import { initChat, chat } from "./chat.js";
import { toast } from "./toast.js";

export default class Whitby extends View {
  init(_props, cx) {
    const p = props();
    this.part = p?.part ?? (p?.overlay && p?.title !== undefined ? "toast" : undefined);
    if (this.part === "rail") initRail(this, cx);
    if (this.part === "sidebar") initSidebar(this, cx);
    if (this.part === "footer") { sampleStats(this, cx); initUsage(this, cx); }
    if (this.part === "home") initHome(this);
    if (this.part === "chat") initChat(this, cx);
  }

  render() {
    switch (this.part) {
      case "titlebar": return titlebar(this);
      case "rail": return rail(this);
      case "sidebar": return sidebar(this);
      case "header": return header();
      case "footer": return footer(this);
      case "home": return home(this);
      case "chat": return chat(this);
      // The usage card, in an overlay the footer opens (see usage.js).
      case "usage-card": return usageCard(props()?.card);
      case "toast": return toast();
      default: return div();
    }
  }
}
