// Shared look and data for the Whitby layout's parts.
// Colors and sizes come from Whitby's source (src/ui/primitives.rs, sidebar_view.rs,
// collapsible.rs, terminal_view.rs); herdr theme names carry the shared tokens.

import { svg } from "gpui-kit";
import { theme, settings, panes, terminals, agents, focused, home, keys, exec, window, shared, setShared } from "herdr";

export const ICON = (name) => `mods/whitby/icons/${name}.svg`;

// "#rrggbb" at an opacity, as Whitby's muted-at-N% text and rules.
export function alpha(color, amount) {
  if (!/^#[0-9a-f]{6}$/i.test(color ?? "")) return color;
  return color + Math.round(amount * 255).toString(16).padStart(2, "0");
}

// Whitby's faint steps of muted (labels, counts, fold arrows, rules), by their light value.
// Dark mode takes Zed One Dark's color for each one's role: border.variant for rules, the
// scrollbar thumb, editor.line_number for the faintest marks, icon.disabled and
// text.placeholder for arrows, counts and quiet dots, border.focused for an open chip's
// border, and text.muted and icon.muted for labels and secondary lines. Light keeps
// Whitby's muted-at-N%.
const ZED = {
  0.15: "#363c46", 0.28: "#c8ccd44c", 0.3: "#4e5a5f", 0.4: "#878a98", 0.45: "#47679e", 0.5: "#878a98",
  0.55: "#878a98", 0.6: "#a9afbc", 0.65: "#a9afbc", 0.7: "#a9afbc", 0.75: "#a9afbc", 0.8: "#878a98", 0.85: "#a9afbc",
};

// Theme tokens plus the few Whitby colors herdr has no name for.
export function palette() {
  const t = theme();
  const dark = Boolean(settings()?.dark);
  const tone = (light, night) => (dark ? night : light);
  // Muted at a faint step, as Whitby's muted-at-N% (in dark, Zed One Dark's, see ZED).
  const fade = (a) => (dark && ZED[a]) || alpha(t.muted, a);
  return {
    ...t,
    dark,
    fade,
    running: tone("#189a30", "#1c882d"),
    // Status dots: soft enough to sit quietly beside a title.
    dot: {
      working: "#6cbf8a", running: alpha("#6cbf8a", 0.5), done: "#8ab0f7", idle: fade(0.55),
      stopped: fade(0.3), blocked: "#e5787a", error: "#e5787a", needs: "#a78bfa",
    },
    // The same states as words, where a label needs one.
    word: { working: tone("#2e9f4b", "#4cc06a"), running: tone("#2e9f4b", "#4cc06a"), blocked: tone("#b54343", "#ff938a"), error: tone("#b54343", "#ff938a"), needs: tone("#7c5cd6", "#b49cfb") },
    live: "#2e9f4b",
    failed: "#b54343",
    warn: tone("#b7791f", "#d49338"),
    // Whitby's blue for marks, lines and links; dark takes Zed One Dark's accent. Whitby's
    // solid blue stays the fill under white text (buttons, your messages, the bell's badge).
    blue: tone("#246cf4", "#74ade8"),
    link: tone("#246cf4", "#74ade8"),
    // Inline code (paths): Zed One Dark's element.hover in dark.
    codeBg: tone(alpha(t.muted, 0.14), "#363c46"),
    front: tone("#ffffff", "#2f343e"),
    body: tone("#f9f9fb", "#282c33"),
    rowHover: tone("#f9f9fb", "#2f343e"),
    // The rail, the sidebar's filter row and the agent header: Whitby's canvas in light;
    // in dark, Zed One Dark's panel and tab bar background.
    bar: tone(t.canvas, "#2f343e"),
    // Text fields: in dark, Zed One Dark's search field (the editor's background, edged
    // in its border).
    field: tone("#f8f8fa", "#282c33"),
    // The focused pane's line: Whitby's blue in light; in dark, Zed One Dark's
    // border.focused.
    focus: tone("#246cf4", "#47679e"),
    placeholder: tone("#999ba3", "#878a98"),
    footer: tone("#f8f8fa", "#3b414d"),
    footerBorder: tone("#d9d9e0", "#464b57"),
    footerMuted: tone("#60646c", "#a9afbc"),
  };
}

// A Whitby icon; without a color it takes the text color around it (hover included).
export function icon(name, size, color) {
  const el = svg(ICON(name)).size(size).flex_none();
  return color ? el.text_color(color) : el;
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

export function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

// The pane a tab is known by: its agent, else the focused one, else the first.
export function lead(tab, all = panes()) {
  const mine = all.filter((p) => p.tab === tab.id);
  return mine.find((p) => p.program?.agent) ?? mine.find((p) => p.focused) ?? mine[0];
}

const base = (path) => (path ?? "").replace(/\/+$/, "").split("/").pop();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The last real title each terminal had (see paneTitle).
const named = new Map();

// What a pane calls itself: an agent's own title, else the program. Like Solo's title
// helper, it drops what agents tack on (Grok's " - grok", Codex's " | <folder>") and
// treats a bare folder or program name as no title at all.
export function paneTitle(p) {
  if (!p) return "";
  const prog = p.program?.name;
  const folder = base(p.cwd);
  // "grok-build" titles itself "... - grok": the app's first word counts as its name too.
  const names = [p.program?.key, prog, p.app, p.app?.split("-")[0], p.program?.key?.split("-")[0]];
  const tails = [...names, folder].filter(Boolean).map(escape);
  let live = clean(p.title);
  if (tails.length) live = live.replace(new RegExp(`\\s+[-|·]\\s+(${tails.join("|")})$`, "i"), "").trim();
  const plain = [prog, p.program?.key, p.app, folder, p.terminal].filter(Boolean).map((s) => s.toLowerCase());
  const telling = live && !plain.includes(live.toLowerCase()) && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@");
  // While it works, Grok's title is what it's doing ("Waiting for response..."): keep
  // the name it had before, so the row doesn't change under you.
  const key = p.terminal ?? p.pane;
  if (telling && /(\.\.\.|…)$/.test(live) && named.has(key)) return named.get(key);
  if (telling) named.set(key, live);
  return telling ? live : prog || live || "shell";
}

// A row's name, as Whitby names an agent: a tab someone named, else its pane's title.
export function tabTitle(tab, all = panes()) {
  return tab.named ? tab.name : paneTitle(lead(tab, all));
}

// Agents a terminal started: terminals run from inside it (`hc run`), as herdr's agents
// list counts them. What its program reports about its own work (OSC 7501 records, as
// Grok's loops and monitors) has no terminal to show, so it isn't listed.
export function children(address, all = terminals()) {
  if (!address) return [];
  // A finished one stays, stopped, as Solo keeps a finished child in the tree (when
  // terminals() still lists it; herdr leaves most finished terminals out).
  return all.filter((k) => k.parent === address && (k.state === "live" || k.state === "finished")).map((k) => ({ key: k.address, address: k.address, terminal: k }));
}

// Everything under a terminal, at any depth (Whitby's "+N subprocesses").
export function subCount(address, all = terminals()) {
  return children(address, all).reduce((n, c) => n + 1 + subCount(c.address, all), 0);
}

// The subagents a terminal's program reports about its own work, still running: its OSC
// 7501 records (Claude Code's subagents, Grok's loop runs) that haven't finished
// (done, or error for failed). They have no terminal to list, so a row counts them as "+N".
export function helperCount(address, all = terminals()) {
  const own = all.find((k) => k.address === address)?.records ?? {};
  return Object.values(own).filter((r) => r.state !== "done" && r.state !== "error").length;
}

// What a terminal says about itself (herdr-core's words): its status, which can be
// "error" where herdr's agent lists only say blocked, and what a block waits on
// (permission, question or auth), when the program says.
export function reportOf(address, ts = terminals()) {
  const k = address ? ts.find((x) => x.address === address) : null;
  return { word: k?.status ?? null, kind: k?.report?.kind ?? null };
}

// One word for every status dot: working, running (a live terminal no agent status
// speaks for), done (finished while you were away), idle, error, blocked or needs
// (a block, split by what it waits on), stopped (finished).
export function stateOf(status, live = true, report = null) {
  if (!live) return "stopped";
  if (status === "error" || (status === "blocked" && report?.word === "error")) return "error";
  if (status === "blocked") return blockedState(report?.kind);
  return status ?? "running";
}

// Which blocks show as "Blocked" (pulsing red) and which as "Needs you" (pulsing purple):
// waiting on an approval is blocked; a question, a sign-in or an unexplained block needs you.
export function blockedState(kind) {
  return kind === "permission" ? "blocked" : "needs";
}

// Unread, as Whitby means it: an agent that wants your attention (finished while you
// were away, blocked, needing you, or failed) and that you haven't looked at in that
// state. Looking at it marks it read; a new state makes it unread again. The bell counts
// exactly these, and each gets the unread dot. Shared, so every part agrees.
const ATTENTION = new Set(["done", "blocked", "needs", "error"]);
const READ = "whitby.read";

// In Whitby Chat, the agents switched to their terminal (the view key, or Split), by
// address; the rest show their chat. Shared, so every part agrees.
export const TERMINAL = "whitby.terminal";

// Agents asking something they haven't reported to herdr: a dialog before they start (as
// Claude Code's folder trust or Codex's update offer) says nothing. Whitby Chat reads it off
// their screen and shares it here, address → "needs", so every part shows them waiting on you.
export const ASKING = "whitby.asking";
export const askingOf = (address) => (address ? (shared(ASKING) ?? {})[address] ?? null : null);

// An agent's state with what Whitby Chat read: an unreported question is "needs".
export const stateWithAsking = (status, address, live = true, report = null) =>
  (!status && live && askingOf(address)) || stateOf(status, live, report);

// Every agent, and every terminal asking something it hasn't reported (see ASKING).
function waitingAgents() {
  const listed = agents();
  const asking = panes().filter((p) => p.terminal && !p.status && askingOf(p.terminal) && !listed.some((a) => a.address === p.terminal))
    .map((p) => ({ address: p.terminal, pane: p.pane, status: null }));
  return [...listed, ...asking];
}

export function attentionOf(status, address, ts = terminals()) {
  const state = stateWithAsking(status, address, true, reportOf(address, ts));
  return ATTENTION.has(state) ? state : null;
}

export function isUnread(status, address, ts = terminals()) {
  const state = attentionOf(status, address, ts);
  return Boolean(state) && (shared(READ) ?? {})[address] !== state;
}

// Agents that are unread, most urgent first: errors and blocks, then finished work.
export function unreadAgents(ts = terminals()) {
  const rank = { error: 0, blocked: 1, needs: 2, done: 3 };
  return waitingAgents()
    .filter((a) => isUnread(a.status, a.address, ts))
    .sort((x, y) => rank[attentionOf(x.status, x.address, ts)] - rank[attentionOf(y.status, y.address, ts)]);
}

// Marks the agent you're looking at as read in its current state, and forgets what was
// read for agents whose state has moved on. Writes only when something changed.
export function markRead(ts = terminals()) {
  const read = shared(READ) ?? {};
  const next = {};
  const all = waitingAgents();
  for (const a of all) {
    const state = attentionOf(a.status, a.address, ts);
    if (state && read[a.address] === state) next[a.address] = state;
  }
  const f = focused();
  if (window()?.active !== false && f?.terminal) {
    const a = all.find((x) => x.address === f.terminal);
    const state = a && attentionOf(a.status, a.address, ts);
    if (state) next[a.address] = state;
  }
  const same = Object.keys(next).length === Object.keys(read).length && Object.entries(next).every(([k, v]) => read[k] === v);
  if (!same) setShared(READ, next);
}

// A sub-agent's state. It reports to its parent, so its "done" isn't news: it shows idle,
// and one whose terminal ended is stopped.
export function subStatus(c) {
  const k = c.terminal;
  return stateOf(k?.status === "done" ? "idle" : k?.status, k?.state === "live", { word: k?.status, kind: k?.report?.kind });
}

// A sub-agent's name: the one it was given, else its own title, else its program.
export function childTitle(c) {
  const k = c.terminal;
  return k.name || paneTitle({ title: k.title, program: k.program }) || k.template || k.address;
}

export const STATE = { working: "Working", running: "Running", done: "Done", idle: "Idle", blocked: "Blocked", needs: "Needs you", error: "Error", stopped: "Stopped" };

// Whitby's resource figures: CPU and resident memory of each local terminal's process
// tree, sampled every 3s while the window is in front (Solo's refresh), into v.stats.
export function sampleStats(v, cx) {
  v.stats ??= {};
  const sample = (cx) => {
    if (window()?.active === false || v.sampling) return;
    v.sampling = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("ps", ["-axo", "pid=,ppid=,pcpu=,rss="]);
        const kids = new Map(), self = new Map();
        for (const line of r.stdout.split("\n")) {
          const [pid, ppid, cpu, rss] = line.trim().split(/\s+/).map(Number);
          if (!pid) continue;
          self.set(pid, { cpu, mem: rss * 1024 });
          if (!kids.has(ppid)) kids.set(ppid, []);
          kids.get(ppid).push(pid);
        }
        const tree = (pid) => {
          const own = self.get(pid) ?? { cpu: 0, mem: 0 };
          return (kids.get(pid) ?? []).map(tree).reduce((a, b) => ({ cpu: a.cpu + b.cpu, mem: a.mem + b.mem }), { ...own });
        };
        const stats = {};
        for (const k of terminals()) if (k.pid && !k.address.includes("/") && self.has(k.pid)) stats[k.address] = tree(k.pid);
        v.stats = stats;
      } catch {}
      v.sampling = false;
      cx.notify();
    });
  };
  sample(cx);
  cx.timer.every(3000, sample);
}

// Whitby's badge text: "12.3%", "245MB", "1.2GB" (src/sidebar_metrics.rs).
export const cpuText = (cpu) => `${cpu.toFixed(1)}%`;
export function memText(bytes) {
  const mib = 1024 * 1024, gib = 1024 * mib;
  return bytes >= gib ? `${(bytes / gib).toFixed(1)}GB` : `${Math.round(bytes / mib)}MB`;
}

// Whitby's default thresholds for showing a badge (src/sidebar_preferences.rs presets).
export const SHOW = { rowCpu: 30, rowMem: 500 * 1024 * 1024, projectCpu: 25, projectMem: 1024 * 1024 * 1024 };

export function badges(stat, cpuMin, memMin) {
  if (!stat) return [];
  return [stat.cpu >= cpuMin ? cpuText(stat.cpu) : null, stat.mem >= memMin ? memText(stat.mem) : null].filter(Boolean);
}

// The key bound to a command, drawn the macOS way: cmd-] is ⌘].
export function keyFor(command) {
  const bound = (keys() ?? []).find((k) => k.action === command && (k.section === "global" || k.section === "terminal"));
  if (!bound) return null;
  const glyph = { cmd: "⌘", shift: "⇧", alt: "⌥", ctrl: "⌃", up: "↑", down: "↓", left: "←", right: "→" };
  return bound.keys.split("-").map((k) => glyph[k] ?? k.toUpperCase()).join("");
}
