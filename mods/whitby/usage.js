// Plan usage for the agent in view, in the agent footer: thin bars for its limits (Claude's
// five-hour session over its weekly limit; Codex's and Grok's as they report them), shown
// only while the pane runs that agent. The tooltip gives each one's share used and the
// time until it resets. A Grok team seat has no share to show (its team manages its
// limits), so it shows what the session has cost so far, as Grok's /usage does.
//
// Plain elements only: gpui-base's HoverCard and Progress parts are native components, and
// building them as the footer redraws held up the whole window on every click.
//
// An account is read while one of its agents runs anywhere: at once, then every two
// minutes. Tokens come from where each CLI keeps its sign-in (Claude Code: the login
// keychain; Codex: ~/.codex/auth.json; Grok: ~/.grok/auth.json). They are held only for
// the request, and never saved, shown, shared or renewed here: each CLI renews its own.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, readTextFile, home, terminals, panes } from "herdr";
import { alpha } from "./kit.js";

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
// error in the tooltip. Checks every 15s, so a new agent's account is read soon after it
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

// The tooltip, a line each: "Claude", "Session 11% used, resets in 3h 40m", "Weekly 42%
// used, resets in 3d 19h", "Updated 1m ago", and any error after it. A team seat's gives
// the session's cost, tokens and model calls instead.
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

function bar(t, w) {
  return div().w_full().h(6).rounded(1.5).bg(alpha(t.footerMuted, 0.25))
    .child(div().h_full().w(`${Math.min(100, w.used)}%`).rounded(1.5).bg(level(t, w.used) ?? t.blue));
}

// The footer's usage for one account (see providerOf): its bars, or on a team seat the
// cost of the session in view.
export function usage(t, id, u = {}, session = null) {
  const p = PROVIDERS[id];
  const text = details(p, u, session);
  const el = h_flex()
    .id("whitby-usage")
    .flex_none()
    .gap(6)
    .items_center()
    .tooltip(text)
    .accessibility_label(text);
  if (u.team) return el.child(div().child(`${p.name} (Team)`)).child(div().child(`Cost: ${session ? dollars(session.cost) : "–"}`));
  // Without figures yet, the bars are faint empty tracks.
  const windows = u.windows ?? Array.from({ length: p.slots }, () => ({ used: 0 }));
  return el
    .child(div().child(p.name))
    .child(v_flex().w(72).gap(4).opacity(u.windows ? 1 : 0.5).children(windows.map((w) => bar(t, w))));
}
