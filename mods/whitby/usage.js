// Plan usage for the agent in view, in the agent footer: thin bars for its limits (Claude's
// five-hour session over its weekly limit; Codex's and Grok's as they report them), shown
// only while the pane runs that agent. Resting the pointer on them opens a card with each
// one's share used and the time until it resets. A Grok team seat has no share to show (its
// team manages its limits), so it shows what the session has cost so far, as Grok's /usage
// does.
//
// Plain elements only: gpui-base's HoverCard and Progress parts are native components, and
// building them as the footer redraws held up the whole window on every click. The card is
// drawn in an overlay of its own instead (see usageCard).
//
// An account is read while one of its agents runs anywhere: at once, then every two
// minutes. Tokens come from where each CLI keeps its sign-in (Claude Code: the login
// keychain; Codex: ~/.codex/auth.json; Grok: ~/.grok/auth.json). They are held only for
// the request, and never saved, shown, shared or renewed here: each CLI renews its own.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, readTextFile, home, terminals, panes, openOverlay, closeOverlay, settings, window } from "herdr";
import { alpha, palette } from "./kit.js";

const STALE = 120000;

// A failure with words fit to show. Other errors are never shown: their messages can
// quote what failed to parse, and that can be a credential.
const problem = (title, detail) => Object.assign(new Error(title), { detail });
const notSignedIn = (p) => problem("Not signed in", `${p.signIn}, then wait for the next refresh.`);
const expired = (p) => problem("Sign-in expired", `Use ${p.cli} once to renew it.`);

const num = (n) => (typeof n === "number" && Number.isFinite(n) ? n : 0);

// The endpoints' timestamps can carry microseconds; Date.parse is only promised milliseconds.
const parseTime = (iso) => (typeof iso === "string" ? Date.parse(iso.replace(/(\.\d{3})\d+/, "$1")) : NaN);

// A limit's name from its length: Session for five hours, Weekly for seven days.
function span(seconds) {
  if (seconds === 18000) return "Session";
  if (seconds === 604800) return "Weekly";
  return seconds < 86400 ? `${Math.round(seconds / 3600)}h` : `${Math.round(seconds / 86400)}d`;
}

async function getJson(p, url, headers) {
  let res;
  try {
    res = await fetch(url, { headers });
  } catch {
    throw problem("Offline", `${p.company} couldn't be reached. Retrying in two minutes.`);
  }
  if (res.status === 401) throw expired(p);
  if (res.status === 429) throw problem("Rate limited", `${p.company} asked to slow down. Retrying in two minutes.`);
  if (!res.ok) throw problem("Usage unavailable", `${p.company} returned HTTP ${res.status}.`);
  return res.json();
}

async function claude(p) {
  const r = await exec("/usr/bin/security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"]);
  const oauth = r.code === 0 ? JSON.parse(r.stdout).claudeAiOauth : null;
  if (!oauth?.accessToken) throw notSignedIn(p);
  if (oauth.expiresAt && oauth.expiresAt <= Date.now()) throw expired(p);
  const data = await getJson(p, "https://api.anthropic.com/api/oauth/usage",
    { Authorization: `Bearer ${oauth.accessToken}`, "anthropic-beta": "oauth-2025-04-20" });
  const windows = [["Session", data?.five_hour], ["Weekly", data?.seven_day]]
    .map(([label, x]) => ({ label, used: num(x?.utilization), reset: parseTime(x?.resets_at) }));
  return { windows };
}

async function codex(p) {
  const text = await readTextFile(`${home()}/.codex/auth.json`);
  const tokens = text ? JSON.parse(text).tokens : null;
  if (!tokens?.access_token) throw notSignedIn(p);
  const headers = { Authorization: `Bearer ${tokens.access_token}` };
  if (tokens.account_id) headers["ChatGPT-Account-Id"] = tokens.account_id;
  const data = await getJson(p, "https://chatgpt.com/backend-api/wham/usage", headers);
  const windows = [data?.rate_limit?.primary_window, data?.rate_limit?.secondary_window]
    .filter((x) => x && typeof x.limit_window_seconds === "number")
    .sort((a, b) => a.limit_window_seconds - b.limit_window_seconds)
    .map((x) => ({ label: span(x.limit_window_seconds), used: num(x.used_percent), reset: typeof x.reset_at === "number" ? x.reset_at * 1000 : NaN }));
  if (!windows.length) throw problem("No limits reported", "OpenAI reports no plan limits for this account.");
  return { windows };
}

// A personal plan's quota, or for a team seat (no share used reported) the team's name.
async function grok(p) {
  const text = await readTextFile(`${home()}/.grok/auth.json`);
  const login = text ? Object.values(JSON.parse(text))[0] : null;
  if (!login?.key) throw notSignedIn(p);
  if (parseTime(login.expires_at) <= Date.now()) throw expired(p);
  const data = await getJson(p, "https://cli-chat-proxy.grok.com/v1/billing?format=credits", { Authorization: `Bearer ${login.key}` });
  const c = data?.config;
  if (typeof c?.creditUsagePercent !== "number") return { windows: [], team: login.team_name || "your team" };
  const type = c.currentPeriod?.type ?? "";
  const label = type.includes("WEEK") ? "Weekly" : type.includes("MONTH") ? "Monthly" : "Period";
  return { windows: [{ label, used: c.creditUsagePercent, reset: parseTime(c.currentPeriod?.end) }] };
}

// What each local Grok session has cost so far: the totals at the top of the usage file
// Grok keeps for it (the figures its /usage shows), keyed by the terminal it runs in.
// A terminal's foreground process is matched to its session in active_sessions.json.
// Returns whether anything changed.
async function readGrokSessions(v) {
  const text = await readTextFile(`${home()}/.grok/active_sessions.json`);
  const open = text ? JSON.parse(text) : [];
  const next = {};
  for (const k of terminals()) {
    const s = k.state === "live" && !k.address.includes("/") && open.find((x) => x.pid === k.foreground?.pid);
    if (!s) continue;
    // Only the head: the file goes on with every turn's figures.
    const r = await exec("/usr/bin/head", ["-c", "16384", `${home()}/.grok/sessions/${encodeURIComponent(s.cwd)}/${s.session_id}/usage.json`]);
    if (r.code !== 0) continue;
    const cut = r.stdout.indexOf('"turns"');
    try {
      const u = JSON.parse(cut < 0 ? r.stdout : `${r.stdout.slice(0, cut).replace(/,\s*$/, "")}}`).session;
      next[k.address] = { cost: num(u?.costUsdTicks) / 1e10, tokens: num(u?.totalTokens), cached: num(u?.cachedReadTokens), calls: num(u?.modelCalls) };
    } catch {}
  }
  const changed = JSON.stringify(next) !== JSON.stringify(v.sessions);
  v.sessions = next;
  return changed;
}

const PROVIDERS = {
  claude: { name: "Claude", cli: "Claude Code", company: "Anthropic", signIn: "Sign in to Claude Code", slots: 2, read: claude },
  codex: { name: "Codex", cli: "Codex", company: "OpenAI", signIn: "Run codex login", slots: 1, read: codex },
  grok: { name: "Grok", cli: "Grok", company: "xAI", signIn: "Run grok login", slots: 1, read: grok },
};

// Which account a pane or terminal's agent uses, from a pane's `app` ("claude-code",
// "grok-build") or a terminal's program key ("claude"). Grok's program key is "agent", so a
// Grok terminal is known only through its pane. null for shells and other programs.
export function providerOf(x) {
  const names = [x?.app, x?.agent, x?.program?.key].filter(Boolean).join(" ");
  return /claude/i.test(names) ? "claude" : /codex/i.test(names) ? "codex" : /grok/i.test(names) ? "grok" : null;
}

// Keeps v.usage[provider] = { windows, team, updated, error } for every account an agent
// runs on, in a pane or in a live terminal (a sub-agent has a terminal and no pane). One
// reading serves every tab of that account. A failed read keeps the last figures, with the
// error in the card. Checks every 15s, so a new agent's account is read soon after it
// starts; on a Grok team seat, each session's cost (v.sessions) is read every check.
export function initUsage(v, cx) {
  v.usage = {};
  v.sessions = {};
  const busy = {}, tried = {};
  const tick = (cx) => {
    const running = [...panes(), ...terminals().filter((k) => k.state === "live")];
    for (const id of new Set(running.map(providerOf).filter(Boolean))) {
      if (busy[id] || Date.now() - (tried[id] ?? 0) < STALE) continue;
      busy[id] = true;
      tried[id] = Date.now();
      cx.spawn(async (cx) => {
        const p = PROVIDERS[id];
        try {
          v.usage[id] = { ...(await p.read(p)), updated: Date.now(), error: null };
        } catch (e) {
          const error = e.detail ? { title: e.message, detail: e.detail } : { title: "Usage unavailable", detail: `${p.name}'s usage couldn't be read.` };
          v.usage[id] = { ...v.usage[id], error };
        }
        busy[id] = false;
        cx.notify();
      });
    }
    if (v.usage.grok?.team && !busy.sessions) {
      busy.sessions = true;
      cx.spawn(async (cx) => {
        try {
          if (await readGrokSessions(v)) cx.notify();
        } catch {}
        busy.sessions = false;
      });
    }
  };
  tick(cx);
  cx.timer.every(15000, tick);
}

// Quiet until a limit is close: amber from 75%, red from 95%.
function level(t, used) {
  return used >= 95 ? t.failed : used >= 75 ? t.warn : null;
}

const percent = (used) => (used > 0 && used < 1 ? "<1%" : `${Math.round(used)}%`);
const dollars = (n) => `$${n.toFixed(2)}`;
const count = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// "resets in 3d 12h", "2h 15m" or "40m".
function resetText(at, now = Date.now()) {
  if (!Number.isFinite(at)) return "not started";
  const minutes = Math.ceil((at - now) / 60000);
  if (minutes <= 0) return "resetting now";
  const d = Math.floor(minutes / 1440), h = Math.floor(minutes / 60) % 24, m = minutes % 60;
  return `resets in ${d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`}`;
}

// What the bars say, for screen readers, a line each: "Claude", "Session 11% used, resets
// in 3h 40m", "Weekly 42% used, resets in 3d 19h", "Updated 1m ago", and any error after it.
// A team seat's gives the session's cost, tokens and model calls instead.
function details(p, u, session) {
  const parts = [u.team ? `${p.name} (Team)` : p.name];
  if (u.team) {
    parts.push(`Usage limits are managed by ${u.team}`);
    if (session) parts.push(`Session cost: ${dollars(session.cost)}`, `Session tokens: ${count(session.tokens)} (${count(session.cached)} cached)`, `Model calls: ${count(session.calls)}`);
    else parts.push("No session usage yet");
  }
  for (const w of u.windows ?? []) parts.push(`${w.label} ${percent(w.used)} used, ${resetText(w.reset)}`);
  if (u.updated && u.windows?.length) {
    const minutes = Math.floor((Date.now() - u.updated) / 60000);
    parts.push(minutes < 1 ? "Updated just now" : `Updated ${minutes}m ago`);
  }
  if (u.error) parts.push(`${u.error.title}: ${u.error.detail}`);
  else if (!u.windows) parts.push("Reading usage…");
  return parts.join("\n");
}

function bar(t, used, height, track) {
  return div().w_full().h(height).rounded(1.5).bg(track)
    .child(div().h_full().w(`${Math.min(100, used)}%`).rounded(1.5).bg(level(t, used) ?? t.blue));
}

// The card: drawn by a Whitby copy of its own in an overlay above the bars (as herdr's own
// popups are), so building it costs the footer nothing. CARD is its width; the overlay is
// taller, see-through, with the card at its bottom and room around it for the shadow.
const CARD = 232, ROOM = 8, TALL = 300, DELAY = 400;

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function meter(t, w) {
  return v_flex()
    .gap(4)
    .child(h_flex().items_center().justify_between()
      .child(div().text_size(11.5).text_color(t.foreground).child(w.label))
      .child(div().text_size(11.5).font_weight(600).text_color(level(t, w.used) ?? t.foreground).child(`${percent(w.used)} used`)))
    .child(bar(t, w.used, 3, alpha(t.muted, 0.15)))
    .child(div().text_size(10).text_color(alpha(t.muted, 0.7)).child(capital(resetText(w.reset))));
}

function fact(t, label, value) {
  return h_flex().items_center().justify_between()
    .child(div().text_size(11.5).text_color(t.foreground).child(label))
    .child(div().text_size(11.5).font_weight(600).text_color(t.foreground).child(value));
}

// The overlay copy's whole view: props().card = { id, u, session } from the footer.
export function usageCard(card) {
  const t = palette();
  const p = PROVIDERS[card?.id];
  if (!p) return div();
  const u = card.u ?? {}, session = card.session;
  const updated = u.updated && u.windows?.length ? Math.floor((Date.now() - u.updated) / 60000) : null;
  return v_flex()
    .size_full()
    .justify_end()
    .px(ROOM)
    .pb(ROOM)
    // A press on an overlay window would otherwise drag it.
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .child(v_flex()
      .w_full()
      .p(12)
      .gap(10)
      .bg(t.popover)
      .border(1)
      .border_color(t.border)
      .rounded(8)
      .shadow_md()
      .child(h_flex().gap(6).items_center()
        .child(div().flex_none().text_size(10).font_weight(600).text_color(alpha(t.muted, 0.6)).child((u.team ? `${p.name} (Team)` : p.name).toUpperCase()))
        .child(div().flex_1().min_w(0).h(1).bg(alpha(t.muted, 0.15)))
        .when(updated != null, (el) => el.child(div().flex_none().text_size(10).text_color(alpha(t.muted, 0.5)).child(updated < 1 ? "Updated just now" : `Updated ${updated}m ago`))))
      .when(Boolean(u.team), (el) => el
        .child(div().text_size(10).text_color(alpha(t.muted, 0.7)).child(`Usage limits are managed by ${u.team}`))
        .child(session
          ? v_flex().gap(4)
            .child(fact(t, "Session cost", dollars(session.cost)))
            .child(fact(t, "Tokens", count(session.tokens)))
            .child(fact(t, "Cached", count(session.cached)))
            .child(fact(t, "Model calls", count(session.calls)))
          : div().text_size(11.5).text_color(t.muted).child("No session usage yet")))
      .children((u.windows ?? []).map((w) => meter(t, w)))
      .when(Boolean(u.error), (el) => el.child(v_flex().gap(2)
        .child(div().text_size(11.5).font_weight(600).text_color(t.warn).child(u.error.title))
        .child(div().text_size(10).text_color(alpha(t.muted, 0.7)).child(u.error.detail))))
      .when(!u.windows && !u.error, (el) => el.child(div().text_size(11.5).text_color(t.muted).child("Reading usage…"))));
}

function closeCard(v) {
  v.cardHover = false;
  v.cardGen = (v.cardGen ?? 0) + 1;
  if (v.cardId) closeOverlay(v.cardId);
  v.cardId = null;
}

// Called on every footer render with the agent in view ("claude:t7", or null): closes the
// card, and drops one waiting to open, once that changes or the window goes to the back.
// A tab switch gives no hover-out: by keyboard the pointer is still on the bars, and bars
// that go away with their tab get no event at all.
export function syncCard(v, key) {
  const stale = v.cardKey !== key || window()?.active === false;
  v.cardKey = key;
  if (stale && (v.cardId || v.cardHover)) closeCard(v);
}

// Whether the pointer is on the bars: v.cardBox, their bounds in the window from the
// pointer's last move on them, against GPUI's window (the global Herdr's window() hides).
function pointerOn(v) {
  const b = v.cardBox, p = globalThis.window?.mouse_position?.();
  if (!b || !p) return true;
  return p.x >= b.x - 1 && p.x <= b.x + b.width + 1 && p.y >= b.y - 1 && p.y <= b.y + b.height + 1;
}

// Opens the card once the pointer has rested on the bars for DELAY, above them, and closes
// it when the pointer leaves (and see syncCard). A window overlay, unlike a popup, leaves
// the keyboard with the terminal.
function hover(v, on, cx, card) {
  if (!on) return closeCard(v);
  v.cardHover = true;
  const gen = (v.cardGen = (v.cardGen ?? 0) + 1);
  cx.timer.after(DELAY, (cx) => {
    if (!v.cardHover || v.cardGen !== gen || v.cardId || !v.cardBox) return;
    if (!pointerOn(v)) return closeCard(v);
    // An overlay's size follows the zoom; `at`, like the pointer's position, doesn't.
    const z = Number(settings()?.zoom) || 1;
    v.cardId = openOverlay({
      mod: "whitby",
      kind: "window",
      frame: "none",
      width: CARD + ROOM * 2,
      height: TALL,
      at: { x: Math.max(0, v.cardBox.x - ROOM * z), y: Math.max(0, v.cardBox.y - (6 - ROOM + TALL) * z) },
      props: { part: "usage-card", card },
    });
    // A quick move off the bars can come without their hover-out, and nothing redraws the
    // footer when the window goes to the back: so while it is open, the card checks.
    const open = v.cardId;
    const watch = (cx) => {
      if (v.cardId !== open) return;
      if (window()?.active === false || !pointerOn(v)) closeCard(v);
      else cx.timer.after(150, watch);
    };
    cx.timer.after(150, watch);
  });
}

// The footer's usage for one account (see providerOf): its bars, or on a team seat the
// cost of the session in view. Resting the pointer on it opens the card.
export function usage(t, id, u = {}, session = null, v = {}) {
  const p = PROVIDERS[id];
  const text = details(p, u, session);
  const el = h_flex()
    // Its own id per agent, so the bars of the next agent take a fresh hover.
    .id(`whitby-usage-${v.cardKey ?? id}`)
    .flex_none()
    .gap(6)
    .items_center()
    .accessibility_label(text)
    // A move on the bars also starts the wait again when nothing is open or waiting, as
    // after syncCard closed the card while the pointer stayed on them.
    .on_mouse_move((e, cx) => {
      v.cardBox = e.bounds;
      if (!v.cardHover && !v.cardId) hover(v, true, cx, { id, u, session });
    })
    .on_hover((on, cx) => hover(v, on, cx, { id, u, session }));
  if (u.team) return el.child(div().child(`${p.name} (Team)`)).child(div().child(`Cost: ${session ? dollars(session.cost) : "–"}`));
  // Without figures yet, the bars are faint empty tracks.
  const windows = u.windows ?? Array.from({ length: p.slots }, () => ({ used: 0 }));
  return el
    .child(div().child(p.name))
    .child(v_flex().w(72).gap(4).opacity(u.windows ? 1 : 0.5).children(windows.map((w) => bar(t, w.used, 6, alpha(t.footerMuted, 0.25)))));
}
