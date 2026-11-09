// Whitby Chat's agent page: the shown agent as a conversation, after Grok Bot's chat, in
// place of its terminal. Everything around it is Whitby's: the sidebar picks the agent,
// the header names it and the footer has its keys, usage and figures.
//
// The agent still runs in its terminal. The chat reads the session its CLI writes (see
// chat-agents.js), and the composer types into the terminal with `hc send`, as you would.
// Stop is `hc interrupt`. An agent opens on its chat and stays there until you press the
// view key (cmd-`), which switches it to its terminal and back; Whitby never switches on
// its own. A shell or an agent the chat can't read shows its terminal, having no chat.
// Messages go only to an agent at its prompt or at work, never into one of its dialogs.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea, TextView } from "gpui-base";
import { hc, exec, home, layout, run, notify, window, terminals, panes, pickFolder, shared, setShared, nextCommand } from "herdr";
import { palette, alpha, icon, stateOf, reportOf, ASKING, STATE, TERMINAL } from "./kit.js";
import { current, shownIn } from "./header.js";
import { KINDS, kindOf, unlisted, fromAgent } from "./chat-agents.js";
import { readDialog, answerKeys, screenTail, LINKS } from "./chat-screen.js";

const MONO = "Geist Mono";
// Whitby's corners: 4px on bubbles, cards and controls (only status dots are round).
const RADIUS = 4;
// The conversation column, centered, as Grok Bot keeps it.
const COLUMN = 760;
// A new time line when this long has passed between messages.
const GAP = 30 * 60 * 1000;
// How much of a session to read when the chat first opens it, and how many items to keep.
const TAIL = 1_500_000, KEEP = 400;
// The chat's clock. Every TICK it sends what's queued, reads the shown agent's session when
// SHOWN has passed and every other chat agent's when BACKGROUND has (so a click shows it at
// once), and looks for a session's file again after REFIND (a new session after /clear).
const TICK = 200, SHOWN = 600, BACKGROUND = 4000, REFIND = 10_000;
// How often the shown agent's subagents at work are read (see KINDS.claude.subagents).
const SUBAGENTS = 2000;
// How long after a chip opens or closes the chat holds what's on screen (see viewport).
const HOLD = 400;
// How often the screen of an agent that's starting or asking something is read, so its
// question shows in the chat (chat-screen.js).
const SCREEN = 500, SCREEN_BACKGROUND = 2000;
// How long an answered prompt's card waits for its agent to report back.
const ANSWER_HOLD = 20_000;

const ICON_LOADER = "mods/whitby/icons/loader-circle.svg";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The states in which an agent is at its own prompt or at work, so a message can go in. An
// agent that hasn't reported yet may be showing a dialog of its own first (a trust prompt,
// an update offer) and a blocked one is asking something: Enter would answer either.
const READY = new Set(["idle", "working", "done"]);

// The agent the page shows, if it's one the chat reads: the header's pane, or a sub-agent
// shown in it; with another pane of its tab focused (a split), the tab's agent. `ready`: at
// its prompt or at work, so a message can go in. `sub`: a shown sub-agent, which has no
// pane of its own to move.
function shownAgent() {
  const pane = current();
  const k = shownIn(pane);
  let p = k ? { ...pane, terminal: k.address, program: k.program, app: k.agent, status: k.status, cwd: k.cwd } : pane;
  if (!k && pane && !kindOf(pane)) p = panes().find((x) => x.tab === pane.tab && x.pane !== pane.pane && kindOf(x)) ?? pane;
  const kind = kindOf(p);
  return kind ? { p, kind, address: p.terminal, ready: READY.has(p.status), sub: Boolean(k) } : null;
}

// What the chat shows: the shown agent, unless you switched it to its terminal. Whitby
// doesn't switch on its own: an agent is on its chat until you press the view key.
function chatTarget() {
  const a = shownAgent();
  return a && !(shared(TERMINAL) ?? []).includes(a.address) ? a : null;
}

// The view key: the shown agent (the tab's, from any of its panes) between its chat and
// its terminal.
export function toggleView() {
  const a = shownAgent();
  if (!a) return;
  const list = shared(TERMINAL) ?? [];
  setShared(TERMINAL, list.includes(a.address) ? list.filter((x) => x !== a.address) : [...list, a.address]);
  showChat({});
}

// The view key arrives as the mod command whitby.view (keys.json); the sidebar, always on
// screen, listens for it. The loop touches its cx before acting, so a reloaded build's loop
// ends there instead of acting too (herdr ends an old build's loop at its next cx use).
export function listenForView(cx) {
  cx.spawn(async (cx) => {
    for (;;) {
      const command = await nextCommand();
      cx.notify();
      if (command === "view") toggleView();
    }
  });
}

// In Whitby Chat, picks the chat or the terminal for a tab you're about to show (a click
// in the sidebar), before it shows, so its terminal never flashes on the way to its chat:
// the chat for the tab's agent, unless you switched it to its terminal; else the terminal.
export function showTabView(tab) {
  const stack = find(layout(), "agent-view");
  if (!stack || !tab) return;
  const agent = panes().find((p) => p.tab === tab.id && kindOf(p));
  const want = agent && !(shared(TERMINAL) ?? []).includes(agent.terminal) ? "chat" : "main";
  if (stack.active !== want) run("layout.select", { stack: "agent-view", child: want });
}

// In Whitby Chat, shows the chat or the terminal for the shown agent (the "agent-view"
// stack). The sidebar calls this as it draws, as it does showHome.
export function showChat(v) {
  const stack = find(layout(), "agent-view");
  if (!stack) return;
  // A tab that has just opened isn't listed yet: it stays on the (blank) chat until it is,
  // rather than flashing its terminal before its agent shows.
  const pane = current();
  const want = chatTarget() || (unlisted(pane) && !shownIn(pane)) ? "chat" : "main";
  if (stack.active === want) { v.chatAsked = null; return; }
  if (v.chatAsked === want) return;
  v.chatAsked = want;
  run("layout.select", { stack: "agent-view", child: want });
}

export function initChat(v, cx) {
  v.feeds = new Map();
  v.inputs = new Map();
  v.typed = new Map();
  // Messages waiting for their agent to be ready, and ones sent that its session doesn't
  // have yet, by address.
  v.queue = new Map();
  v.pending = new Map();
  v.flushing = new Set();
  // What each agent that's starting or asking shows on its screen ({ dialog, tail }), the
  // ones being answered now, and the ones whose free-text option you picked: the composer
  // types your answer into that field.
  v.screens = new Map();
  v.answering = new Set();
  v.freeText = new Set();
  // The prompt each agent was answered on ({ key, dialog, at }, see promptKey), so a prompt
  // is answered once and its card stays, answered, until the agent reports back; and the
  // agents whose prompt changed on screen as you answered it.
  v.answered = new Map();
  v.changed = new Set();
  v.open = new Set();
  v.lift = 0;
  v.viewH = 0;
  v.contentH = 0;
  cx.timer.every(TICK, (cx) => tick(v, cx));
  tick(v, cx);
}

// UTF-8 bytes in a string: how far a read got into the file.
function bytes(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

function newFeed(kind) {
  return { kind, path: null, startedAt: 0, foundAt: 0, readAt: 0, offset: 0, items: [], tools: new Map(), agents: new Map(), agentsAt: 0, reading: false, loaded: false, cut: false };
}

// Every chat agent in the window: each pane's, and a sub-agent shown in one.
function chatAgents() {
  const list = panes().map((p) => ({ p, kind: kindOf(p), address: p.terminal })).filter((a) => a.kind);
  const shown = shownAgent();
  if (shown && !list.some((a) => a.address === shown.address)) list.push(shown);
  return list;
}

// Each agent gets its composer and its conversation before you click it, so the chat is
// there at once. The shown one is read often, the rest now and then; while the window is
// behind others, only first loads happen. Queued messages go whenever their agent is ready.
function tick(v, cx) {
  if (!find(layout(), "agent-view")) return;
  // The chat or the terminal, as the shown agent's view is set (see showChat).
  showChat(v);
  const shown = chatTarget()?.address;
  const front = window()?.active !== false;
  const now = Date.now();
  for (const a of chatAgents()) {
    if (!v.inputs.has(a.address)) composer(v, a.address);
    flush(v, a.address, cx);
    if (READY.has(a.p.status)) { v.screens.delete(a.address); v.freeText.delete(a.address); v.answered.delete(a.address); v.changed.delete(a.address); }
    // An answer the agent never reported back on (it went away, say) stops holding its card.
    else if (now - (v.answered.get(a.address)?.at ?? now) > ANSWER_HOLD) v.answered.delete(a.address);
    else {
      const sc = v.screens.get(a.address);
      if (!sc?.reading && now - (sc?.readAt ?? 0) >= (a.address === shown ? SCREEN : SCREEN_BACKGROUND)) readScreen(v, a.address, cx);
    }
    let feed = v.feeds.get(a.address);
    if (!feed || feed.kind !== a.kind) {
      feed = carried(v, a) ?? newFeed(a.kind);
      v.feeds.set(a.address, feed);
      if (v.moved?.feed === feed) v.moved = null;
    }
    // Behind other windows, only a first load: the rest waits until you come back.
    if (!front && feed.loaded) continue;
    if (!feed.reading && now - feed.readAt >= (a.address === shown ? SHOWN : BACKGROUND)) refresh(v, feed, a.address, cx);
  }
  // While the shown agent's subagents work, their clocks count each second.
  const second = Math.floor(now / 1000);
  if (front && shown && second !== v.second && runningAgents(v.feeds.get(shown)).length) {
    v.second = second;
    cx.notify();
  }
  shareAsking(v);
}

// Shares the agents asking something they haven't reported to herdr (see kit.js ASKING), so
// the sidebar, the bell, the header and the footer show them waiting on you. Writes only
// when that changes.
function shareAsking(v) {
  const asking = {};
  // An answered prompt counts until the agent reports back, so nothing jumps in between.
  for (const a of chatAgents()) {
    if (!a.p.status && (v.screens.get(a.address)?.dialog || v.answered.has(a.address))) asking[a.address] = "needs";
  }
  const now = shared(ASKING) ?? {};
  const key = (m) => Object.keys(m).sort().join(",");
  if (key(asking) !== key(now)) setShared(ASKING, asking);
}

// Reads the screen of an agent that's starting or asking something, for its question.
function readScreen(v, address, cx) {
  const before = v.screens.get(address);
  v.screens.set(address, { ...before, reading: true });
  cx.spawn(async (cx) => {
    const r = await hc(["read", address, "--lines", "40"]).catch(() => ({ code: 1, stdout: "" }));
    const text = r.code === 0 ? r.stdout : "";
    const next = { dialog: readDialog(text), tail: screenTail(text), readAt: Date.now(), reading: false };
    v.screens.set(address, next);
    // A different prompt can be answered again. The answered one going (or the screen
    // blanking as the agent moves on) keeps its card until the agent reports back.
    if (next.dialog && v.answered.has(address) && promptKey(next.dialog) !== v.answered.get(address).key) {
      v.answered.delete(address);
      v.changed.delete(address);
    }
    const same = JSON.stringify(before?.dialog ?? null) === JSON.stringify(next.dialog) && before?.tail === next.tail;
    if (!same && chatTarget()?.address === address) cx.notify();
  });
}

// Which prompt it is: its question and its options (not where its cursor is, which moves
// as it's answered).
const promptKey = (d) => JSON.stringify([d.question, d.options.map((o) => o.label)]);

// Answers the agent's prompt with option `to`: the arrow keys to it, then Enter, as you
// would in its terminal (Cancel presses Esc). Right before the keys go, the screen is read
// again: a different prompt sends nothing, and the card shows what's there now; the keys
// start from where its cursor is then. Each prompt is answered once; its card then waits,
// answered, for the agent to report back. A free-text option is only moved to: the composer
// then types your answer into its field.
function answer(v, address, dialog, to, cx) {
  if (v.answering.has(address) || v.answered.get(address)?.key === promptKey(dialog)) return;
  v.answering.add(address);
  cx.notify();
  cx.spawn(async (cx) => {
    const r = await hc(["read", address, "--lines", "40"]).catch(() => ({ code: 1, stdout: "" }));
    const text = r.code === 0 ? r.stdout : "";
    const now = readDialog(text);
    if (!now || promptKey(now) !== promptKey(dialog)) {
      v.screens.set(address, { dialog: now, tail: screenTail(text), readAt: Date.now(), reading: false });
      v.changed.add(address);
    } else {
      const keys = to === "esc" ? ["esc"] : answerKeys(now, to);
      await hc(["keys", address, ...keys]).catch(() => {});
      v.changed.delete(address);
      if (to !== "esc" && dialog.options[to].free) {
        v.freeText.add(address);
        v.inputs.get(address)?.focus();
      } else {
        v.answered.set(address, { key: promptKey(dialog), dialog, at: Date.now() });
      }
    }
    v.answering.delete(address);
    cx.notify();
  });
}

// Presses keys in the agent's terminal for a question the chat can't read as a menu.
function press(v, address, keys, cx) {
  if (v.answering.has(address)) return;
  v.answering.add(address);
  cx.spawn(async (cx) => {
    await hc(["keys", address, ...keys]).catch(() => {});
    v.screens.delete(address);
    v.answering.delete(address);
    cx.notify();
  });
}

// Finds the agent's session file now and then, and reads what's new in it. Redraws only
// when the agent it read is the one shown.
function refresh(v, feed, address, cx) {
  feed.reading = true;
  cx.spawn(async (cx) => {
    let changed = !feed.loaded;
    try {
      if (!feed.path || Date.now() - feed.foundAt > REFIND) {
        const info = JSON.parse((await hc(["get", address, "--json"])).stdout);
        const path = await KINDS[feed.kind].find(info).catch(() => null);
        // A restarted agent (resumed) is read again, for what went with its last process.
        const startedAt = (await KINDS[feed.kind].started?.(info).catch(() => 0)) ?? 0;
        if (path !== feed.path || startedAt !== feed.startedAt) {
          Object.assign(feed, newFeed(feed.kind), { path, startedAt, reading: true });
          changed = true;
        }
        feed.foundAt = Date.now();
      }
      if (feed.path && (await read(feed))) changed = true;
      const working = runningAgents(feed);
      const subagents = KINDS[feed.kind].subagents;
      if (subagents && feed.path && working.length && Date.now() - feed.agentsAt >= SUBAGENTS) {
        const found = await subagents(feed.path, working.map((it) => it.id)).catch(() => null);
        for (const [id, info] of found ?? []) feed.agents.set(id, info);
        feed.agentsAt = Date.now();
        changed = true;
      }
    } catch (err) {
      console.log(`whitby chat: ${address}: ${err}`);
    }
    Object.assign(feed, { reading: false, loaded: true, readAt: Date.now() });
    if (changed && chatTarget()?.address === address) cx.notify();
  });
}

async function read(feed) {
  const size = Number((await exec("stat", ["-f", "%z", feed.path]).catch(() => ({ stdout: "" }))).stdout.trim());
  if (!Number.isFinite(size) || size === feed.offset) return false;
  if (size < feed.offset) Object.assign(feed, { offset: 0, items: [], tools: new Map() });
  let start = feed.offset;
  const first = start === 0 && size > TAIL;
  if (first) { start = size - TAIL; feed.cut = true; }
  let text = (await exec("tail", ["-c", `+${start + 1}`, feed.path])).stdout;
  let skipped = 0;
  // Read from the middle of a long session: the first line is a piece of one.
  if (first) {
    const nl = text.indexOf("\n");
    skipped = bytes(text.slice(0, nl + 1));
    text = text.slice(nl + 1);
  }
  const end = text.lastIndexOf("\n");
  if (end < 0) { feed.offset = start + skipped; return false; }
  const body = text.slice(0, end + 1);
  feed.offset = start + skipped + bytes(body);
  const { parse, wanted } = KINDS[feed.kind];
  for (const line of body.split("\n")) {
    // Lines the chat never shows (Claude's API request copies, Codex's token counts) are
    // skipped before they're parsed: most of a session's bytes.
    if (!line.startsWith("{") || !wanted(line)) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    try { parse(e, feed); } catch (err) { console.log(`whitby chat: ${feed.kind} line: ${err}`); }
  }
  if (feed.items.length > KEEP) { feed.items = feed.items.slice(-KEEP); feed.cut = true; }
  return true;
}

// The composer's text, one per agent. Enter sends, Shift+Enter starts a new line. The
// textarea puts Enter's newline in before it says "submit", so that newline is dropped.
// Its placeholder is drawn by composerArea, in Whitby's placeholder grey.
function composer(v, address) {
  const st = TextareaState.new({});
  st.set_auto_grow(1, 8);
  st.on("change", (_e, cx) => {
    const before = v.typed.get(address) ?? "";
    v.typed.set(address, st.value());
    if (Boolean(before.trim()) !== Boolean(st.value().trim())) cx.notify();
  });
  st.on("submit", (e, cx) => {
    if (e.shift) return;
    send(v, address, st.value().replace(/\n$/, ""), cx);
  });
  v.inputs.set(address, st);
  return st;
}

const liveState = (address) => terminals().find((k) => k.address === address)?.status;

// Whether the composer answers the agent's question rather than messaging it: you picked a
// free-text option, or the agent is blocked on a question that isn't a menu.
function answeringByText(v, address) {
  if (v.freeText.has(address)) return true;
  const sc = v.screens.get(address);
  return liveState(address) === "blocked" && Boolean(sc?.readAt) && !sc.dialog;
}

// A message joins the agent's queue and goes as soon as the agent is ready (see flush): at
// once when it's at its prompt or at work, else once it has started or you've answered
// what it asks. Until then it shows, faded, as queued.
function send(v, address, text, cx) {
  text = text.trim();
  if (!text) return;
  v.inputs.get(address)?.set_value("");
  v.typed.set(address, "");
  // An answer to the agent's question, typed into its field (a free-text option, or a
  // question that isn't a menu): straight in, since the agent is waiting on exactly that.
  if (answeringByText(v, address)) {
    v.freeText.delete(address);
    v.screens.delete(address);
    cx.spawn(async (cx) => {
      await hc(["send", "--force", address, text]).catch(() => {});
      cx.notify();
    });
    cx.notify();
    return;
  }
  const q = v.queue.get(address) ?? [];
  q.push({ text, at: Date.now(), tries: 0 });
  v.queue.set(address, q);
  v.lift = 0;
  flush(v, address, cx);
  cx.notify();
}

// Types the queued messages into the agent's terminal, oldest first, as if you had, while
// it's ready (READY): never into one of its dialogs. `hc send --if` refuses if its state
// changed on the way; the message then waits for the next try, three at most.
function flush(v, address, cx) {
  const q = v.queue.get(address);
  if (!q?.length || v.flushing.has(address) || !READY.has(liveState(address))) return;
  v.flushing.add(address);
  cx.spawn(async (cx) => {
    while (q.length) {
      const state = liveState(address);
      if (!READY.has(state)) break;
      const m = q[0];
      const r = await hc(["send", ...(state === "done" ? [] : ["--if", state]), address, m.text])
        .catch((err) => ({ code: 1, stderr: String(err), stdout: "" }));
      if (r.code !== 0 && ++m.tries < 3) break;
      q.shift();
      if (r.code !== 0) {
        const st = v.inputs.get(address);
        if (st && !st.value()) { st.set_value(m.text); v.typed.set(address, m.text); }
        notify({ title: "Couldn't send the message", body: (r.stderr || r.stdout).trim().split("\n").pop() || `hc send exited ${r.code}`, level: "error" });
        continue;
      }
      const sent = v.pending.get(address) ?? [];
      sent.push({ text: m.text, at: Date.now() });
      v.pending.set(address, sent);
    }
    v.flushing.delete(address);
    cx.notify();
  });
}

function stop(address, cx) {
  cx.spawn(async () => { await hc(["interrupt", address]).catch(() => {}); });
}

// ---------------------------------------------------------------------------------------
// Drawing

const pad = (n) => String(n).padStart(2, "0");
function clock(d) {
  const h = d.getHours() % 12 || 12;
  return `${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;
}
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The time line over a run of messages, as Grok Bot draws it: "Today 1:47 PM".
function stampText(ms) {
  const d = new Date(ms), now = new Date();
  const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
  const day = days === 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? DAYS[d.getDay()] : `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return `${day} ${clock(d)}`;
}

const firstLine = (s) => (s ?? "").split("\n").find((l) => l.trim())?.trim() ?? "";
const tidy = (s) => firstLine(s).split(home() + "/").join("~/");
const bubble = (t) => (t.dark ? "#363c46" : "#f8f8f9");

function stamp(t, ms, i) {
  return h_flex().id(`stamp-${i}`).w_full().justify_center().pt(6).pb(2).text_size(11).text_color(t.muted).child(stampText(ms));
}

// Text the chat draws itself (your messages, questions, notes), with what's in it picked
// out: web addresses and known link words (LINKS) as links, only as wide as their words, the
// address on hover and opened on a click; paths as inline code, as a backticked path is in a
// reply. Laid out a word at a time so it still wraps as text does. Text with neither stays
// one plain element.
const URL = /^https?:\/\/\S+$/;
const PATH = /^(~|\.{1,2})?\/[^\s/]/;
const TRAIL = /[.,;:!?)\]"'’”]+$/;
const PICK = /https?:\/\/|(^|\s)(~|\.{1,2})?\/[^\s/]/;

function link(t, id, label, url, o) {
  return div().id(`${id}-tip`).flex_none().tooltip(url)
    .child(div().id(id).text_color(o.link ?? t.link).cursor_pointer().when(Boolean(o.underline), (el) => el.underline())
      .hover((s) => s.underline()).on_click(() => exec("open", [url])).child(label));
}

function word(t, id, w, o) {
  const trail = w.match(TRAIL)?.[0] ?? "";
  const core = trail ? w.slice(0, -trail.length) : w;
  const el = URL.test(core) ? link(t, id, core, core, o)
    : PATH.test(core) ? div().flex_none().px(4).rounded(RADIUS).bg(o.code ?? t.codeBg).font_family(MONO).text_size(o.codeSize ?? 11.5).child(core)
    : null;
  if (!el) return div().flex_none().mr(4).child(w);
  return h_flex().flex_none().mr(4).items_center().child(el).when(Boolean(trail), (h) => h.child(div().child(trail)));
}

function inline(t, id, text, o = {}) {
  const lines = text.split("\n");
  if (!lines.some((l) => LINKS[l.trim()] || PICK.test(l))) return div().min_w(0).child(text);
  return v_flex().min_w(0).children(lines.map((line, i) => {
    const whole = LINKS[line.trim()];
    if (whole) return h_flex().child(link(t, `${id}-${i}`, line.trim(), whole, o));
    const words = line.split(/\s+/).filter(Boolean);
    return h_flex().flex_wrap().items_center().min_h(o.lineHeight ?? 18).children(words.map((w, j) => word(t, `${id}-${i}-${j}`, w, o)));
  }));
}

// Your messages: Whitby blue, on the right. Faded while on their way, with a line under
// one that's queued.
function userMessage(t, it, faded, caption) {
  // Capped at 80% of the column, so long messages wrap rather than run off the left. Links
  // in it are white and underlined, paths on a lighter blue.
  const style = { link: t.solid_foreground, underline: true, code: alpha("#ffffff", 0.2), codeSize: 12.5, lineHeight: 20 };
  return v_flex().w_full().items_end().gap(4)
    .child(div().max_w("80%").min_w(0).px(14).py(9).rounded(RADIUS).bg(t.solid).text_color(t.solid_foreground).text_size(13.5).line_height("20px")
      .opacity(faded ? 0.55 : 1).child(inline(t, `user-${it.at ?? 0}-${it.text.length}`, fromAgent(it.text.trim()), style)))
    .when(Boolean(caption), (el) => el.child(h_flex().gap(4).items_center().text_size(10.5).text_color(t.muted)
      .child(icon("clock", 11))
      .child(div().child(caption))));
}

// The agent's replies: markdown in a grey bubble, on the left.
// A single newline is a line break, as in a chat and in the agent's own terminal, so a
// poem or a list of lines keeps its lines. Fenced code is left as it is.
function breaks(md) {
  return md.split(/(```[\s\S]*?```)/g)
    .map((part, i) => (i % 2 ? part : part.split("\n").map(ticks).join("\n").replace(/([^\n])\n(?=[^\n])/g, "$1  \n")))
    .join("");
}

// Inline code that ends in a backtick, as agents write it: `cmd-`` (one backtick to open,
// two to close), which markdown leaves as plain text, backticks and all. Each such span
// becomes the code it means (`` cmd-` ``). A span markdown already closes, with a run of
// backticks as long as its opener, is left as it is.
function ticks(line) {
  const runs = [...line.matchAll(/`+/g)];
  let out = "", at = 0;
  for (let i = 0; i < runs.length; i++) {
    const n = runs[i][0].length;
    const close = runs.findIndex((r, j) => j > i && r[0].length === n);
    if (close >= 0) { i = close; continue; }
    const open = runs[i].index, next = runs[i + 1];
    if (n !== 1 || next?.[0].length !== 2 || next.index === open + 1) continue;
    out += line.slice(at, open) + "`` " + line.slice(open + 1, next.index) + "` ``";
    at = next.index + 2;
    i++;
  }
  return out + line.slice(at);
}

function reply(t, key, it) {
  return h_flex().w_full().justify_start().pr(64)
    .child(v_flex().min_w(0).px(14).py(9).rounded(RADIUS).bg(bubble(t)).text_color(t.foreground).text_size(13.5)
      .child(TextView.markdown(`chat-md-${key}`, breaks(it.text || " ")).selectable(true)));
}

function toggle(v, key, cx) {
  v.open.has(key) ? v.open.delete(key) : v.open.add(key);
  v.keepAt = Date.now();
  cx.notify();
}

// Tool calls and reasoning fold into short chips, one per kind of work in a run of them:
// "Ran 2 commands", "Edited 3 files", "Reasoning". A click opens a chip: its calls, each
// with what it ran and a check, a spinner or a cross, and a call's output on a click. A
// call still running has its own chip, "Running · <what>", with a spinner.
const FOLD = {
  command: { icon: "square-terminal", say: (n) => (n === 1 ? "Ran a command" : `Ran ${n} commands`) },
  edit: { icon: "file", say: (n) => (n === 1 ? "Edited a file" : `Edited ${n} files`) },
  read: { icon: "file", say: (n) => (n === 1 ? "Read a file" : `Read ${n} files`) },
  search: { icon: "search", say: (n) => (n === 1 ? "Searched the code" : `Searched the code ${n} times`) },
  web: { icon: "search", say: (n) => (n === 1 ? "Searched the web" : `Searched the web ${n} times`) },
  agent: { icon: "sparkles", say: (n) => (n === 1 ? "Ran a subagent" : `Ran ${n} subagents`) },
  tool: { icon: "wrench", say: (n, calls) => (n === 1 ? `Used ${calls[0].name}` : `Used ${n} tools`) },
  thinking: { icon: "sparkles", say: () => "Reasoning" },
};

function toolKind(it) {
  if (it.kind === "thinking") return "thinking";
  const n = (it.name ?? "").toLowerCase();
  if (/web|fetch|url|browse/.test(n)) return "web";
  if (/bash|shell|command|terminal|exec|^run/.test(n)) return "command";
  if (/^task$|agent/.test(n)) return "agent";
  if (/edit|write|replace|patch|notebook|create/.test(n)) return "edit";
  if (/read|view|open/.test(n)) return "read";
  if (/grep|glob|search|find|list|ls\b|dir/.test(n)) return "search";
  return "tool";
}

// How many a chip stands for: files for edits and reads, calls for the rest.
function folded(kind, calls) {
  const n = kind === "edit" || kind === "read" ? new Set(calls.map((c) => c.detail || c.id)).size : calls.length;
  return FOLD[kind].say(n, calls);
}

function mark(t, status) {
  if (status === "running") return svg(ICON_LOADER).size(11).flex_none().text_color(t.muted).spin(900);
  if (status === "failed") return div().flex_none().text_size(11.5).text_color(t.word.error).child("✕");
  if (status === "stopped") return div().flex_none().text_size(11.5).text_color(t.muted).child("–");
  return div().flex_none().text_size(11.5).text_color(t.word.working).child("✓");
}

function chip(v, t, key, group) {
  const open = v.open.has(key);
  const running = group.kind === "running";
  const failed = group.calls.filter((c) => c.status === "failed").length;
  const call = group.calls[0];
  const label = running ? `Running · ${tidy(call.detail) || call.name}` : folded(group.kind, group.calls);
  const opens = !running || Boolean(call.output);
  return h_flex().id(`chip-${key}`).flex_none().max_w(420).h(26).px(9).gap(6).items_center().rounded(RADIUS)
    .border(1).border_color(open ? t.fade(0.45) : t.border).bg(t.front).text_size(12).text_color(open ? t.foreground : t.muted)
    .when(opens, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground).bg(t.rowHover)).on_click((_e, cx) => toggle(v, key, cx)))
    .child(running ? svg(ICON_LOADER).size(12).flex_none().spin(900) : icon(FOLD[group.kind].icon, 12))
    .child(div().min_w(0).truncate().child(label))
    .when(failed > 0, (el) => el.child(div().flex_none().text_color(t.word.error).child(`· ${failed} failed`)))
    .when(opens, (el) => el.child(icon(open ? "sidebar-chevron-down" : "sidebar-chevron-right", 9)));
}

function output(t, text) {
  const lines = text.split("\n");
  const shown = lines.length > 18 ? [...lines.slice(0, 18), `… ${lines.length - 18} more lines`].join("\n") : text;
  return div().mt(2).mb(4).px(8).py(6).rounded(RADIUS).bg(t.canvas).border(1).border_color(t.border)
    .font_family(MONO).text_size(11).line_height("16px").text_color(t.muted).child(shown);
}

// An open chip's calls: what each ran and how it went; a click shows its output.
function calls(v, t, address, group) {
  if (group.kind === "thinking") {
    return v_flex().gap(8).children(group.calls.map((it) => div().ml(6).pl(12).pr(64).border_l(2).border_color(t.border)
      .text_size(12.5).line_height("19px").text_color(t.muted).child(it.text)));
  }
  return v_flex().gap(1).children(group.calls.flatMap((it) => {
    const key = `${address}-call-${it.index}`;
    const out = (it.output ?? "").trim();
    const row = h_flex().id(`row-${key}`).px(8).py(4).gap(8).items_center().rounded(RADIUS)
      .when(Boolean(out), (el) => el.cursor_pointer().hover((s) => s.bg(t.rowHover)).on_click((_e, cx) => toggle(v, key, cx)))
      .child(div().flex_none().text_size(12).font_weight(600).text_color(t.foreground).child(it.name))
      .child(div().flex_1().min_w(0).truncate().font_family(MONO).text_size(11.5).text_color(t.muted).child(tidy(it.detail)))
      .child(mark(t, it.status));
    return v.open.has(key) && out ? [row, output(t, out)] : [row];
  }));
}

// The subagent calls still running in a feed.
function runningAgents(feed) {
  return (feed?.items ?? []).filter((it) => it.kind === "tool" && it.status === "running" && toolKind(it) === "agent");
}

// "3m 5s", as Claude Code counts a subagent's time.
function elapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// The shown agent's subagents at work, above the reply box, as Claude Code lists them under
// its prompt: each one's task, what it's doing now, how long it has run, and the tokens in
// its latest request.
function subagentList(t, address, feed) {
  const working = runningAgents(feed);
  if (!working.length) return null;
  const now = Date.now();
  return v_flex().id(`subagents-${address}`).w_full().py(4).rounded(RADIUS).bg(t.front).border(1).border_color(t.border)
    .children(working.map((it) => {
      const info = feed.agents?.get(it.id);
      const tokens = info?.tokens ? `↓ ${info.tokens >= 1000 ? `${(info.tokens / 1000).toFixed(1)}k` : info.tokens} tokens` : null;
      const facts = [it.at ? elapsed(now - it.at) : null, tokens].filter(Boolean).join(" · ");
      return h_flex().id(`subagent-${it.id}`).h(26).px(10).gap(8).items_center().text_size(12)
        .child(svg(ICON_LOADER).size(11).flex_none().text_color(t.muted).spin(900))
        .child(div().flex_none().max_w(240).truncate().font_weight(500).text_color(t.foreground).child(tidy(it.detail) || it.name))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(info?.doing ?? "Starting"))
        .child(div().flex_none().text_size(11.5).text_color(t.muted).child(facts));
    }));
}

// A run of tool calls and reasoning: its chips in a row, and under them each open one's calls.
function toolRun(v, t, address, run) {
  const groups = [];
  for (const it of run) {
    if (it.kind === "tool" && it.status === "running") { groups.push({ kind: "running", calls: [it] }); continue; }
    const kind = toolKind(it);
    let g = groups.find((x) => x.kind === kind);
    if (!g) groups.push((g = { kind, calls: [] }));
    g.calls.push(it);
  }
  const keyOf = (g) => `${address}-${run[0].index}-${g.kind}-${g.calls[0].index}`;
  return v_flex().w_full().gap(6)
    .child(h_flex().flex_wrap().gap(6).children(groups.map((g) => chip(v, t, keyOf(g), g))))
    .children(groups.filter((g) => v.open.has(keyOf(g))).map((g) => calls(v, t, address, g)));
}

function note(t, it, i) {
  return h_flex().id(`note-${i}`).w_full().justify_center().py(2).text_size(11.5).text_color(t.muted)
    .child(inline(t, `note-${i}`, it.text, { codeSize: 10.5, lineHeight: 16 }));
}

// The agent at work: three faint dots in a reply bubble, darkening one after another.
// Each dot is the same glyph twice: a faint one, and over it a dark one whose frames show
// it on that dot's step only. All frames share herdr's clock, so the steps stay in order.
const DOT_STEPS = [["●", " ", " "], [" ", "●", " "], [" ", " ", "●"]];
function typing(t) {
  const dot = (steps, i) => div().id(`chat-dot-${i}`).relative().w(10).h(16).text_size(10).line_height("16px")
    .child(div().w_full().text_center().text_color(t.fade(0.3)).child("●"))
    .child(div().absolute().inset(0).text_center().text_color(t.fade(0.85)).frames(steps, 300));
  return h_flex().w_full().justify_start()
    .child(h_flex().id("chat-typing").h(38).px(15).gap(2).items_center().rounded(RADIUS).bg(bubble(t))
      .children(DOT_STEPS.map(dot)));
}

function messages(v, t, address, feed) {
  const out = [];
  if (feed.cut) out.push(h_flex().w_full().justify_center().py(2).text_size(11).text_color(t.fade(0.7)).child("Earlier messages are in the terminal's session."));
  let last = 0;
  let run = [];
  const fold = () => { if (run.length) out.push(toolRun(v, t, address, run)); run = []; };
  feed.items.forEach((it, i) => {
    if (it.kind === "tool" || it.kind === "thinking") { run.push({ ...it, index: i }); return; }
    fold();
    if (it.at && it.at - last > GAP) out.push(stamp(t, it.at, i));
    if (it.at) last = it.at;
    if (it.kind === "user") out.push(userMessage(t, it));
    else if (it.kind === "text") out.push(reply(t, `${address}-${i}`, it));
    else out.push(note(t, it, i));
  });
  fold();
  return out;
}

// Your messages on their way: sent ones the session doesn't have yet, then queued ones.
function outgoing(v, t, address, feed, ready, name) {
  const sent = (v.pending.get(address) ?? []).filter((m) => Date.now() - m.at < 60_000
    && !feed?.items.some((it) => it.kind === "user" && it.at >= m.at - 5000 && it.text.trim().startsWith(m.text.slice(0, 40))));
  v.pending.set(address, sent);
  const queued = v.queue.get(address) ?? [];
  return [
    ...sent.map((m) => userMessage(t, m, true)),
    ...queued.map((m) => userMessage(t, m, true, ready ? "Sending…" : `Queued until ${name} is ready`)),
  ];
}

// The agent loading: a spinner and a line, in the middle.
function loading(t, text) {
  return h_flex().id("chat-loading").w_full().justify_center().gap(6).items_center().py(6).text_size(12).text_color(t.muted)
    .child(svg(ICON_LOADER).size(13).flex_none().text_color(t.muted).spin(900))
    .child(div().child(text));
}

// What the agent is asking, as a card above the reply box: its question, a button for
// each option (the one under its cursor marked), and Cancel when Esc cancels. A pill in
// the sidebar's state color says it's waiting. Once answered, it waits for the prompt to go.
function dialogCard(v, t, address, name, dialog, status) {
  const sent = v.answered.get(address)?.key === promptKey(dialog);
  const busy = v.answering.has(address) || sent;
  const [title, ...rest] = (dialog.question || `${name} is asking`).split("\n");
  // The sidebar's state: red "Blocked" for an approval, purple "Needs you" for the rest.
  const state = status === "blocked" ? stateOf("blocked", true, reportOf(address)) : "needs";
  const pillColor = t.word[state] ?? t.word.needs;
  const note = sent ? "Answer sent. Waiting for the agent."
    : v.changed.has(address) ? "It changed on screen. Here is what it shows now." : null;
  return v_flex().id(`ask-${address}`).w_full().px(14).py(12).gap(10).rounded(RADIUS).bg(t.front).border(1).border_color(t.border)
    .child(h_flex().gap(8).items_start()
      .child(div().flex_1().min_w(0).text_size(13.5).font_weight(600).text_color(t.foreground).child(inline(t, `ask-${address}-title`, title, { lineHeight: 19 })))
      .child(h_flex().flex_none().gap(5).items_center().px(8).py(2).rounded(RADIUS).bg(alpha(pillColor, 0.12))
        .text_size(11).font_weight(500).text_color(pillColor)
        .child(div().size(6).rounded_full().bg(pillColor).loop("opacity", { from: 0.35, to: 1, period: 1600, easing: "ease-in-out" }))
        .child(div().child(STATE[state]))))
    .when(rest.length > 0, (el) => el.child(div().text_size(12.5).line_height("18px").text_color(t.muted)
      .child(inline(t, `ask-${address}-q`, rest.join("\n"), { codeSize: 11.5, lineHeight: 18 }))))
    .child(v_flex().gap(6).opacity(busy ? 0.6 : 1).children(dialog.options.map((o, i) => h_flex().id(`ask-${address}-${i}`).px(12).py(8).gap(10).items_start().rounded(RADIUS)
      .border(1).border_color(i === dialog.selected ? alpha(t.blue, 0.55) : t.border)
      .when(!busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => answer(v, address, dialog, i, cx)))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(13).text_color(t.foreground).child(o.label))
        .when(Boolean(o.detail), (el) => el.child(div().text_size(11.5).text_color(t.muted).child(o.detail)))
        .when(o.free, (el) => el.child(div().text_size(11.5).text_color(t.muted).child("Then type your answer below.")))))))
    .when(Boolean(note) || dialog.esc, (el) => el.child(h_flex().gap(8).items_center()
      .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).child(note ?? ""))
      .when(dialog.esc, (row) => row.child(div().id(`ask-${address}-esc`).flex_none().px(8).py(3).rounded(RADIUS).text_size(12).text_color(t.muted)
        .opacity(busy ? 0.6 : 1)
        .when(!busy, (b) => b.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => answer(v, address, dialog, "esc", cx)))
        .child("Cancel")))));
}

// A question the chat can't read as a menu (a yes/no line, a field): the agent's last
// lines, its arrow, Enter and Esc keys, and the composer types your answer into it.
function screenCard(v, t, address, name, tail) {
  const busy = v.answering.has(address);
  const key = (label, keys) => div().id(`key-${address}-${label}`).px(10).py(4).rounded(RADIUS).border(1).border_color(t.border)
    .text_size(12).text_color(t.foreground)
    .when(!busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => press(v, address, keys, cx)))
    .child(label);
  return v_flex().id(`asking-${address}`).w_full().px(14).py(12).gap(10).rounded(RADIUS).bg(t.front).border(1).border_color(t.border)
    .child(div().text_size(13.5).font_weight(600).text_color(t.foreground).child(`${name} is waiting for an answer`))
    .when(Boolean(tail), (el) => el.child(div().px(8).py(6).rounded(RADIUS).bg(t.canvas).border(1).border_color(t.border)
      .font_family(MONO).text_size(11).line_height("16px").text_color(t.muted).child(tail)))
    .child(h_flex().gap(6).items_center()
      .child(key("↑", ["up"])).child(key("↓", ["down"])).child(key("Enter", ["enter"])).child(key("Esc", ["esc"]))
      .child(div().ml(6).text_size(11.5).text_color(t.muted).child("or type your answer below")));
}

// The conversation scrolls in a viewport of its own, kept on the newest message: it rests
// on its bottom edge and the wheel lifts it. Short chats sit at the top, as Grok Bot's do.
// While you read back, new messages don't move what you're reading, and "Latest" brings you
// down again. While you read back, and as a chip opens or closes, the content holds its top
// edge, so what's on screen stays put (on its bottom edge, it would jump for a frame, until
// its new height came back).
function viewport(v, t, address, body) {
  if (v.viewOf !== address) { v.viewOf = address; v.lift = 0; v.contentH = 0; }
  const room = Math.max(0, v.contentH - v.viewH);
  v.lift = Math.min(v.lift, room);
  const fits = !v.viewH || v.contentH <= v.viewH;
  const keep = v.lift > 0 || Date.now() - (v.keepAt ?? 0) < HOLD;
  const content = v_flex()
    .id(`chat-content-${address}`)
    .absolute()
    .left(0)
    .right(0)
    .when(fits, (el) => el.top(0))
    .when(!fits && keep, (el) => el.top(v.viewH + v.lift - v.contentH))
    .when(!fits && !keep, (el) => el.bottom(0))
    .items_center()
    .px(24)
    .pt(14)
    .pb(18)
    .on_size_change((size, cx) => {
      if (size.height === v.contentH) return;
      // The same top edge at the new height: the top when it fit, else where it was.
      if (keep && v.contentH) {
        const top = v.contentH <= v.viewH ? 0 : v.viewH + v.lift - v.contentH;
        v.lift = Math.max(0, top - v.viewH + size.height);
      }
      v.contentH = size.height;
      cx.notify();
    })
    .child(v_flex().w_full().max_w(COLUMN).gap(10).children(body));
  const thumb = fits ? [] : (() => {
    const h = Math.max(28, (v.viewH * v.viewH) / v.contentH);
    const top = (v.viewH - h) * (1 - v.lift / room);
    return [div().absolute().right(3).top(top).w(5).h(h).rounded_full().bg(t.fade(0.28))];
  })();
  const latest = v.lift > 80 ? [h_flex().absolute().bottom(12).left(0).right(0).justify_center()
    .child(h_flex().id("chat-latest").gap(5).items_center().px(12).py(5).rounded(RADIUS).bg(t.front).border(1).border_color(t.border)
      .shadow_sm().text_size(11.5).text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { v.lift = 0; cx.notify(); })
      .child(div().child("↓"))
      .child(div().child("Latest")))] : [];
  return div()
    .id(`chat-view-${address}`)
    .relative()
    .flex_1()
    .min_h(0)
    .overflow_hidden()
    .on_size_change((size, cx) => {
      if (size.height === v.viewH) return;
      v.viewH = size.height;
      cx.notify();
    })
    .on_scroll_wheel((e, cx) => {
      if (fits) return;
      const next = Math.max(0, Math.min(room, v.lift + e.delta.y));
      if (next === v.lift) return;
      v.lift = next;
      cx.notify();
    })
    .child(content)
    .children([...thumb, ...latest]);
}

function sendButton(v, t, address, ready) {
  return div().id(`send-${address}`).size(30).flex_none().flex().items_center().justify_center().rounded(RADIUS)
    .bg(ready ? t.solid : t.fade(0.16))
    .when(ready, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88))
      .on_click((_e, cx) => send(v, address, v.inputs.get(address)?.value() ?? "", cx)))
    .child(icon("arrow-up", 16, ready ? t.solid_foreground : t.fade(0.8)));
}

function stopButton(t, address) {
  return div().id(`stop-${address}`).size(30).flex_none().flex().items_center().justify_center().rounded(RADIUS)
    .bg(t.foreground).cursor_pointer().hover((s) => s.opacity(0.85)).tooltip("Stop")
    .on_click((_e, cx) => stop(address, cx))
    .child(div().size(10).rounded(1).bg(t.front));
}

// The conversation of an agent that just moved folders, for the agent that took its place
// in the same tab (see move): it shows at once, and the new agent goes on in the same file.
function carried(v, target) {
  const m = v.moved;
  return m && m.tab === target.p.tab && m.feed.kind === target.kind && Date.now() - m.at < 60_000 ? m.feed : null;
}

// Moves the agent to another folder, keeping its conversation: you pick the folder, and
// its CLI goes on there, resuming its session, in the same tab (a new terminal beside the
// old one, which then closes). Every CLI keeps writing the session's file where it was, so
// the chat reads on in the same file.
function move(v, target, cx) {
  const { address, kind, p } = target;
  cx.spawn(async () => {
    const folder = await pickFolder({ prompt: "Work here" });
    if (!folder || folder === p.cwd) return;
    const feed = v.feeds.get(address);
    v.moved = feed ? { tab: p.tab, feed, at: Date.now() } : null;
    run("pane.focus", { pane: p.pane });
    run("terminal.open", { argv: KINDS[kind].resume(KINDS[kind].session(feed?.path)), folder, place: "right" });
    run("pane.close", { pane: p.pane });
  });
}

// Where the agent works, under the composer: a folder icon and the folder's name, its full
// path on hover; a click moves the agent to another folder (move), between turns. The
// tooltip sits on a wrapper, since a tooltip takes the pointer from the element it's on.
function folderChip(v, t, target) {
  const { address, p } = target;
  const cwd = p.cwd;
  const name = !cwd ? "" : cwd === home() ? "~" : cwd.replace(/\/+$/, "").split("/").pop();
  const movable = target.ready && p.status !== "working" && !target.sub;
  const chip = h_flex().id(`folder-${address}`).gap(5).items_center().px(5).py(2).ml(-5).rounded(RADIUS)
    .when(movable, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => move(v, target, cx)))
    .child(icon("folder", 12))
    .child(div().truncate().child(name));
  return div().id(`folder-tip-${address}`).flex_none().min_w(0).tooltip(cwd ?? "").child(chip);
}

// Grok Bot's composer: a field at the foot of the conversation, with Whitby's send button
// (a message to an agent that isn't ready yet is queued); while the agent answers and
// you've typed nothing, the button stops it.
function composerArea(v, t, target, answering) {
  const { address, p } = target;
  const st = v.inputs.get(address);
  const ready = Boolean((v.typed.get(address) ?? "").trim());
  return v_flex()
    .id(`composer-${address}`)
    .flex_none()
    .items_center()
    .px(24)
    .pt(4)
    .pb(12)
    .child(h_flex().w_full().max_w(COLUMN).items_end().gap(6).pl(14).pr(6).py(6).rounded(RADIUS)
      .bg(t.front).border(1).border_color(t.border).shadow_xs()
      // The textarea's own placeholder takes the theme's muted color, as dark as text; so
      // "Message Claude" is drawn underneath in Whitby's placeholder grey, seen through the
      // textarea while it's empty.
      .child(div().relative().flex_1().min_w(0)
        .when(!(v.typed.get(address) ?? ""), (el) => el.child(div().absolute().top(0).left(0).right(0).py(5).truncate()
          .text_size(13.5).text_color(t.placeholder).child(answeringByText(v, address) ? "Type your answer" : `Message ${KINDS[target.kind].name}`)))
        .child(st ? Textarea.new(st).w_full().py(5).bg(alpha(t.front, 0)).text_size(13.5).text_color(t.foreground) : div().h(30)))
      .child(answering && !ready ? stopButton(t, address) : sendButton(v, t, address, ready)))
    .child(h_flex().w_full().max_w(COLUMN).mt(6).px(14).gap(12).items_center().justify_between().text_size(10.5).text_color(t.fade(0.85))
      .child(folderChip(v, t, target))
      .child(div().flex_none().child("⏎ send  ·  ⇧⏎ new line")));
}

export function chat(v) {
  const t = palette();
  const target = chatTarget();
  const frame = v_flex().id("whitby-chat").size_full().min_h(0).bg(t.background);
  if (!target) return frame;
  const { address, p } = target;
  const feed = v.feeds.get(address) ?? carried(v, target);
  const name = KINDS[target.kind].name;
  const said = feed?.items.length ? messages(v, t, address, feed) : [];
  const going = outgoing(v, t, address, feed, target.ready, name);
  // The chat stays put whatever the agent does. Below the conversation: a spinner while the
  // agent starts or its session loads, a line when it waits on its terminal (a question or
  // an approval), the dots while it answers. An agent at work before anyone has said
  // anything to it is still starting (Codex reports working while it sets up).
  const asked = Boolean(going.length) || Boolean(feed?.items.some((it) => it.kind === "user"));
  const starting = !p.status || (p.status === "working" && !asked);
  // A question the agent shows in its terminal, read off its screen, shows above the reply
  // box to answer, whenever the chat shows (also on coming back from the terminal).
  const screen = !READY.has(p.status) ? v.screens.get(address) : null;
  const held = !READY.has(p.status) ? v.answered.get(address)?.dialog : null;
  const card = v.freeText.has(address) ? null
    : screen?.dialog ? dialogCard(v, t, address, name, screen.dialog, p.status)
    : held ? dialogCard(v, t, address, name, held, p.status)
    : p.status === "blocked" && screen?.readAt ? screenCard(v, t, address, name, screen.tail)
    : null;
  const tail = card ? []
    : starting || p.status === "blocked" ? [loading(t, starting ? `Starting ${name}…` : `${name} is asking something…`)]
    : !feed?.loaded ? [loading(t, "Loading the conversation…")]
    : p.status === "working" ? [typing(t)] : [];
  const quiet = feed?.loaded && !said.length && !going.length && !tail.length && !card;
  const empty = quiet ? [h_flex().w_full().justify_center().pt(40).text_size(12.5).text_color(t.muted)
    .child(feed.path ? "Nothing said yet." : `No conversation yet. Send ${name} a message.`)] : [];
  const body = [...said, ...empty, ...going, ...tail];
  const working = subagentList(t, address, feed);
  return frame
    .child(viewport(v, t, address, body))
    .when(Boolean(working), (el) => el.child(v_flex().id(`working-${address}`).flex_none().items_center().px(24).pt(6)
      .child(div().w_full().max_w(COLUMN).child(working))))
    .when(Boolean(card), (el) => el.child(v_flex().id(`card-${address}`).flex_none().items_center().px(24).pt(6)
      .child(div().w_full().max_w(COLUMN).child(card))))
    .child(composerArea(v, t, target, p.status === "working" && !starting));
}
