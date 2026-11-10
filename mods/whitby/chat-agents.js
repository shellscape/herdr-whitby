// The agents Whitby Chat can show as a conversation, and how to read each one. An agent
// runs in its terminal as always; the chat reads the session its CLI writes to disk and
// turns each line into the chat's items:
//
//   { kind: "user", text, at }            a message to the agent
//   { kind: "text", text }                the agent's reply (markdown)
//   { kind: "thinking", text }            its reasoning
//   { kind: "tool", id, name, detail, status: "running" | "done" | "failed", output }
//   { kind: "note", text }                a line in the middle, such as "/clear" or "Stopped"
//
// find(info) gets the session file of the agent `hc get <t> --json` describes (its
// foreground process), or null when it hasn't written one yet. session(path) is that
// file's session ID, and resume(id) the argv that carries the session on in another folder.
// wanted(line) is a quick look at a raw line: false for ones parse() would ignore.

import { exec, home, readTextFile, terminals } from "herdr";
import { ICON } from "./kit.js";

const OUTPUT = 4000;
const clip = (s, n = OUTPUT) => (s.length > n ? s.slice(0, n) + "\n…" : s);
const stamp = (iso) => (iso ? Date.parse(iso) || null : null);

// Text from whatever a tool hands back: a string, a list of blocks, or an object.
function textOf(x, depth = 0) {
  if (x == null || depth > 4) return "";
  if (typeof x === "string") return x;
  if (typeof x === "number" || typeof x === "boolean") return String(x);
  if (Array.isArray(x)) return x.map((y) => textOf(y, depth + 1)).filter(Boolean).join("\n");
  if (typeof x.text === "string") return x.text;
  for (const k of ["content", "Content", "output", "stdout", "result", "message"]) {
    if (x[k] != null) return textOf(x[k], depth + 1);
  }
  return JSON.stringify(x);
}

// The one thing worth showing about a tool call: its command, file, pattern or address.
function detailOf(input) {
  if (!input || typeof input !== "object") return typeof input === "string" ? input : "";
  const v = input.command ?? input.cmd ?? input.file_path ?? input.target_file ?? input.path
    ?? input.target_directory ?? input.pattern ?? input.query ?? input.url ?? input.description ?? input.prompt;
  if (Array.isArray(v)) return v.join(" ");
  if (typeof v === "string") return v;
  const s = JSON.stringify(input);
  return s === "{}" ? "" : s;
}

// A subagent's step in a few words, as Claude Code's terminal lists it: a file by its name,
// a search by what it looks for, a command (or any call with one) by its description.
function stepOf(b) {
  const i = b.input ?? {};
  const file = (p) => String(p ?? "").split("/").pop();
  switch (b.name) {
    case "Read": return `Reading ${file(i.file_path)}`;
    case "Edit": case "MultiEdit": return `Editing ${file(i.file_path)}`;
    case "Write": return `Writing ${file(i.file_path)}`;
    case "Grep": return `Searching for ${i.pattern}`;
    case "Glob": return `Finding ${i.pattern}`;
    case "WebFetch": return `Fetching ${i.url}`;
    case "WebSearch": return `Searching the web for ${i.query}`;
  }
  if (typeof i.description === "string" && i.description.trim()) return i.description.trim();
  const tool = String(b.name ?? "").replace(/^mcp__/, "").split("__").join(" ");
  const detail = detailOf(i);
  return detail && !detail.startsWith("{") ? `${tool} ${detail}` : tool;
}

// What a subagent did last, from the end of its transcript: its latest step, and the tokens
// in its latest request. Null when the end read has none (one long result filled it).
function lastStep(text) {
  const lines = text.split("\n");
  // The first line can be a piece of one.
  for (let i = lines.length - 1; i > 0; i--) {
    if (!lines[i].includes('"type":"assistant"')) continue;
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    if (e.type !== "assistant") continue;
    const u = e.message?.usage ?? {};
    const tokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0);
    const blocks = Array.isArray(e.message?.content) ? e.message.content : [];
    const use = blocks.findLast((b) => b.type === "tool_use");
    const doing = use ? stepOf(use) : blocks.some((b) => b.type === "text" && b.text?.trim()) ? "Writing its report" : "Thinking";
    return { doing, tokens };
  }
  return null;
}

// What Grok files as your turn that you didn't write: a monitor's event (a note: the watcher
// and what it saw), a loop's run (a note: how often it runs), or another reminder (nothing).
// Anything else is yours (undefined).
function grokNote(text) {
  const s = text.trim();
  const monitor = s.match(/^<monitor-event[^>]*>\s*(?:\[([^\]]*)\])?\s*([\s\S]*?)\s*<\/monitor-event>$/);
  if (monitor) {
    const [, label, body] = monitor;
    // Each line an event: a JSON one by its kind, check and outcome.
    const what = body.split("\n").filter((l) => l.trim()).map((l) => {
      try {
        const j = JSON.parse(l);
        return [String(j.kind ?? "").replace(/_/g, " "), j.name, j.conclusion].filter(Boolean).join(" · ");
      } catch {
        return l.trim();
      }
    }).join("; ");
    return [label, what].filter(Boolean).join(": ").slice(0, 240);
  }
  if (/^<system-reminder>/.test(s)) {
    const loop = s.match(/Scheduled task \S+ \(([^)]+)\)/);
    return loop ? `Loop ran (${loop[1]})` : "";
  }
  return undefined;
}

// What a Grok subagent did last, from the end of its session: its latest call (by its
// description, else what it ran), or its thinking or its reply; and the tokens in play.
function grokStep(text) {
  const lines = text.split("\n");
  const tokens = Number([...text.matchAll(/"_meta":\{"totalTokens":(\d+)/g)].pop()?.[1] ?? 0);
  for (let i = lines.length - 1; i > 0; i--) {
    const kind = lines[i].match(/"sessionUpdate":"(tool_call|agent_message_chunk|agent_thought_chunk)"/)?.[1];
    if (!kind) continue;
    if (kind === "agent_message_chunk") return { doing: "Writing its report", tokens };
    if (kind === "agent_thought_chunk") return { doing: "Thinking", tokens };
    let u;
    try { u = JSON.parse(lines[i]).params?.update; } catch { continue; }
    const label = u?._meta?.["x.ai/tool"]?.label || u?.title || "Tool";
    const detail = detailOf(u?.rawInput);
    return { doing: u?.rawInput?.description || (detail && !detail.startsWith("{") ? `${label} ${detail}` : label), tokens };
  }
  return null;
}

// What a Codex subagent did last, from the end of its rollout: its latest item, and the
// tokens in its latest request.
function codexStep(text) {
  const lines = text.split("\n");
  let tokens = 0;
  for (let i = lines.length - 1; i > 0; i--) {
    if (!lines[i].includes('"token_count"') && !lines[i].includes('"item_completed"')) continue;
    let p;
    try { p = JSON.parse(lines[i]).payload; } catch { continue; }
    if (p?.type === "token_count") {
      const u = p.info?.last_token_usage ?? {};
      tokens ||= (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
      continue;
    }
    const it = p?.item;
    if (p?.type !== "item_completed" || !it) continue;
    const file = (f) => String(f ?? "").split("/").pop();
    const doing = it.type === "CommandExecution" ? shellCommand(it.command)
      : it.type === "FileChange" ? `Editing ${Object.keys(it.changes ?? {}).map(file).join(", ")}`
      : it.type === "McpToolCall" ? [it.server, it.tool].filter(Boolean).join(" ")
      : it.type === "AgentMessage" ? "Writing its report"
      : it.type === "Reasoning" ? "Thinking"
      : null;
    if (doing) return { doing, tokens };
  }
  return null;
}

// Codex runs commands as `/bin/zsh -lc '<command>'`: show the command.
function shellCommand(c) {
  const s = Array.isArray(c) ? c[c.length - 1] ?? "" : c ?? "";
  return s.replace(/^\S*\/(?:ba|z)?sh\s+-l?c\s+/, "").replace(/^(['"])([\s\S]*)\1$/, "$2");
}

// A session's file, wherever it is: a session resumed in another folder keeps writing to
// the file it started in, so files are found by session ID, not by the folder.
const ID = /^[0-9A-Za-z-]+$/;
async function newest(pattern, id) {
  if (!ID.test(id ?? "")) return null;
  const r = await exec("/bin/sh", ["-c", `ls -t ${pattern} 2>/dev/null | head -1`, "sh", id]);
  return r.stdout.trim() || null;
}

// Claude Code keeps ~/.claude/sessions/<pid>.json for each running session: its id, and
// when its process started.
async function claudeSession(info) {
  const pid = info.foreground?.pid;
  return pid ? JSON.parse((await readTextFile(`${home()}/.claude/sessions/${pid}.json`)) ?? "null") : null;
}

const push = (feed, item) => { feed.items.push(item); return item; };

// Streamed pieces (Grok's chunks) join the item before them when it's the same kind.
function append(feed, kind, text, at) {
  if (!text) return;
  const last = feed.items[feed.items.length - 1];
  if (last?.kind === kind && !last.closed) last.text += text;
  else push(feed, { kind, text, ...(at ? { at } : {}) });
}

function tool(feed, id, name, detail, status = "running") {
  const known = id != null && feed.tools.get(id);
  if (known) return known;
  const item = push(feed, { kind: "tool", id, name: name || "Tool", detail: detail ?? "", status, output: "" });
  if (id != null) feed.tools.set(id, item);
  return item;
}

// The background work an agent has going (its "work"): subagents, background commands,
// monitors and loops, by id ({ id, type, title, detail?, at, every?, next?, child? }), as its
// terminal lists them. The chat shows them above the reply box.
const work = (feed) => (feed.work ??= new Map());

function endTool(feed, id, status, output) {
  feed.work?.delete(id);
  const item = feed.tools.get(id);
  if (!item) return;
  item.status = status;
  const text = textOf(output).trim();
  if (text) item.output = clip(text);
}

// What Claude Code files under a user turn that the person didn't type.
const CLAUDE_HIDDEN = /^<(local-command-[a-z]+|system-reminder|bash-stdout|bash-stderr|command-message|command-args)>/;

// Text you pasted, as Claude Code files it: wrapped in <pasted_content> (with an id or
// without). The chat shows what you pasted, not the wrapper.
const unpaste = (text) => text.replace(/<pasted_content(?: id="[^"]*")?>\n?/g, "").replace(/\n?<\/pasted_content(?: id="[^"]*")?>/g, "");

function claudeUser(feed, text, at) {
  const s = unpaste(text).trim();
  if (!s || CLAUDE_HIDDEN.test(s)) return;
  const command = s.match(/^<command-name>([^<]*)<\/command-name>/);
  if (command) {
    const args = s.match(/<command-args>([^<]*)<\/command-args>/)?.[1]?.trim();
    return void push(feed, { kind: "note", text: [command[1].trim(), args].filter(Boolean).join(" ") });
  }
  const bash = s.match(/^<bash-input>([\s\S]*)<\/bash-input>$/);
  if (bash) return void push(feed, { kind: "user", text: `! ${bash[1]}`, at });
  // A background task finishing (a subagent, or a command sent to the background): Claude
  // Code tells the agent, not you. Its call ends here, with its result, and a note says so.
  // A subagent that stopped with work of its own still going isn't done: Claude Code tells
  // again when it is, by its task id only.
  if (/^<task-notification>/.test(s)) {
    const tag = (name) => s.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim();
    if (/ is waiting on its own background work$/.test(tag("summary") ?? "")) return;
    const status = tag("status");
    const id = tag("tool-use-id") ?? feed.tasks?.get(tag("task-id"));
    endTool(feed, id, status === "failed" ? "failed" : status === "killed" ? "stopped" : "done", tag("result") ?? tag("summary"));
    return void push(feed, { kind: "note", text: tag("summary") || "Background task finished" });
  }
  if (/^\[Request interrupted by user/.test(s)) return void push(feed, { kind: "note", text: "Stopped" });
  push(feed, { kind: "user", text: s, at });
}

// A message another agent sent with hc (`<hc from="t4">…</hc>`): who it's from, then the text.
export function fromAgent(s) {
  const m = s.match(/^<hc from="([^"]+)">([\s\S]*)<\/hc>$/);
  return m ? `${m[1]}: ${m[2].trim()}` : s;
}

// The Grok updates the chat shows; the rest (commands, plans, memory) aren't parsed.
const GROK_WANTED = /"sessionUpdate":"(user_message_chunk|agent_message_chunk|agent_thought_chunk|tool_call|tool_call_update|turn_completed|auto_compact_completed|subagent_spawned|subagent_finished|task_backgrounded|task_completed|background_tasks|scheduled_task_created|scheduled_task_deleted)"/;

export const KINDS = {
  claude: {
    name: "Claude",
    title: "Claude Code",
    glyph: ICON("clawd"),
    tint: () => "#d97757",
    is: (p) => p?.program?.key === "claude" || p?.app === "claude-code",
    wanted: (line) => line.includes('"type":"user"') || line.includes('"type":"assistant"') || line.includes('"type":"queued_command"'),
    // What takes the messages it holds while at work in at once: Claude Code's "send now".
    sendNow: ["ctrl+enter"],
    // The session's transcript: ~/.claude/projects/<folder, non-alphanumerics as "-">/<session>.jsonl.
    async find(info) {
      return newest('"$HOME"/.claude/projects/*/"$1".jsonl', (await claudeSession(info))?.sessionId);
    },
    // When its process started: a background task from before then went with the process
    // that ran it (a resumed session's).
    started: async (info) => (await claudeSession(info))?.startedAt ?? 0,
    // The subagents of calls still running, by call id. Each one's transcript sits next to
    // the session's (<session>/subagents/agent-<id>.jsonl), its .meta.json naming the call
    // that started it; its end says what it's doing now.
    async subagents(path, entries) {
      const ids = entries.map((w) => w.id);
      const dir = path.replace(/\.jsonl$/, "/subagents");
      const list = 'for m in "$1"/*.meta.json; do [ -f "$m" ] && printf "%s\\t%s\\n" "$m" "$(tr -d "\\n" < "$m")"; done';
      const rows = (await exec("/bin/sh", ["-c", list, "sh", dir])).stdout.split("\n");
      const out = new Map();
      for (const row of rows) {
        const tab = row.indexOf("\t");
        if (tab < 0) continue;
        let meta;
        try { meta = JSON.parse(row.slice(tab + 1)); } catch { continue; }
        if (!ids.includes(meta.toolUseId)) continue;
        const file = row.slice(0, tab).replace(/\.meta\.json$/, ".jsonl");
        const last = lastStep((await exec("tail", ["-c", "262144", file]).catch(() => ({ stdout: "" }))).stdout);
        if (last) out.set(meta.toolUseId, last);
      }
      return out;
    },
    session: (path) => path?.split("/").pop().replace(/\.jsonl$/, ""),
    resume: (id) => ["claude", ...(id ? ["--resume", id] : [])],
    parse(e, feed) {
      // A subagent's own turns: its parent's tool card stands for it.
      if (e.isSidechain) return;
      const at = stamp(e.timestamp);
      const content = e.message?.content;
      // What Claude Code took in mid-turn, filed as a queued command, not a user turn: a
      // background task's notification, or a message you sent while it was at work.
      if (e.type === "attachment") {
        const a = e.attachment;
        if (a?.type !== "queued_command") return;
        const prompt = typeof a.prompt === "string" ? a.prompt
          : Array.isArray(a.prompt) ? a.prompt.filter((b) => b?.type === "text").map((b) => b.text).join("\n") : "";
        if (/^\s*<task-notification>/.test(prompt) || a.origin?.kind === "human") claudeUser(feed, prompt, at);
        return;
      }
      if (e.type === "user") {
        // The summary Claude Code starts a compacted conversation with is its own, not yours.
        if (e.isCompactSummary) return void push(feed, { kind: "note", text: "Context compacted" });
        if (typeof content === "string") { if (!e.isMeta) claudeUser(feed, content, at); return; }
        for (const b of Array.isArray(content) ? content : []) {
          if (b.type === "text" && !e.isMeta) claudeUser(feed, b.text, at);
          else if (b.type === "tool_result") {
            // A subagent or a command sent to the background answers at once, but runs on
            // until Claude Code's task notification for it (see claudeUser).
            const r = e.toolUseResult;
            if (!b.is_error && (r?.status === "async_launched" || r?.backgroundTaskId)) {
              // One from an earlier process went with it, unless its notification follows.
              const it = feed.tools.get(b.tool_use_id);
              if (feed.startedAt && at && at < feed.startedAt) endTool(feed, b.tool_use_id, "stopped");
              else if (it) {
                const type = r.status === "async_launched" ? "subagent" : /monitor/i.test(it.name) ? "monitor" : "command";
                work(feed).set(it.id, { id: it.id, type, title: it.about || it.detail || it.name, detail: it.about ? it.detail : "", at: it.at ?? at });
                (feed.tasks ??= new Map()).set(r.backgroundTaskId ?? r.agentId, it.id);
              }
              continue;
            }
            // A stop call that worked: the task it stopped ends there (no notification follows).
            const stopper = feed.tools.get(b.tool_use_id);
            if (!b.is_error && stopper?.stops && feed.tasks?.has(stopper.stops)) endTool(feed, feed.tasks.get(stopper.stops), "stopped");
            endTool(feed, b.tool_use_id, b.is_error ? "failed" : "done", b.content);
          }
        }
      } else if (e.type === "assistant") {
        for (const b of Array.isArray(content) ? content : []) {
          if (b.type === "text" && b.text?.trim()) push(feed, { kind: "text", text: b.text });
          else if (b.type === "thinking" && b.thinking?.trim()) push(feed, { kind: "thinking", text: b.thinking });
          // When it started (a subagent's clock counts from it), what it says it does, and
          // the background task a stop call names.
          else if (b.type === "tool_use") {
            const it = tool(feed, b.id, b.name, detailOf(b.input));
            it.at ??= at;
            it.about ??= typeof b.input?.description === "string" ? b.input.description : "";
            if (/^(TaskStop|KillShell|KillBash)$/.test(b.name)) it.stops = b.input?.task_id ?? b.input?.shell_id;
          }
        }
      }
    },
  },

  grok: {
    name: "Grok",
    title: "Grok",
    glyph: "icons/grok.svg",
    tint: (t) => t.foreground,
    is: (p) => p?.app === "grok-build" || p?.program?.key === "grok",
    // Enter on an empty input takes the first message it holds while at work in at once;
    // each press the next (sendNowEach).
    sendNow: ["enter"],
    sendNowEach: true,
    // Its subagents' own sessions sit beside its own (<folder>/<child session>/updates.jsonl).
    async subagents(path, entries) {
      const dir = path.replace(/\/[^/]+\/updates\.jsonl$/, "");
      const out = new Map();
      for (const w of entries) {
        if (!w.child) continue;
        const text = (await exec("tail", ["-c", "262144", `${dir}/${w.child}/updates.jsonl`]).catch(() => ({ stdout: "" }))).stdout;
        const last = grokStep(text);
        if (last) out.set(w.id, last);
      }
      return out;
    },
    wanted: (line) => GROK_WANTED.test(line),
    // Grok lists its running sessions in ~/.grok/active_sessions.json, by process; each
    // session folder has updates.jsonl, the conversation as ACP session updates.
    async find(info) {
      const pid = info.foreground?.pid;
      const all = JSON.parse((await readTextFile(`${home()}/.grok/active_sessions.json`)) ?? "[]");
      const s = Array.isArray(all) ? all.find((x) => x.pid === pid) : null;
      return newest('"$HOME"/.grok/sessions/*/"$1"/updates.jsonl', s?.session_id);
    },
    session: (path) => path?.split("/").slice(-2, -1)[0],
    resume: (id) => ["grok", ...(id ? ["--resume", id] : [])],
    parse(e, feed) {
      const u = e.params?.update;
      if (!u) return;
      const at = e.timestamp ? e.timestamp * 1000 : null;
      switch (u.sessionUpdate) {
        case "user_message_chunk": {
          const note = grokNote(u.content?.text ?? "");
          if (note === undefined) append(feed, "user", u.content?.text, at);
          else if (note) push(feed, { kind: "note", text: note });
          return;
        }
        case "agent_message_chunk": append(feed, "text", u.content?.text); return;
        case "agent_thought_chunk": append(feed, "thinking", u.content?.text); return;
        case "tool_call": {
          const meta = u._meta?.["x.ai/tool"];
          tool(feed, u.toolCallId, meta?.label || u.title, detailOf(u.rawInput) || (meta?.label ? u.title : ""));
          return;
        }
        case "tool_call_update": {
          if (u.status !== "completed" && u.status !== "failed") return;
          const out = u.rawOutput ?? u.content;
          // A subagent started in the background, or a call sent there (a command, a
          // monitor): it runs on until Grok says it finished (below).
          const sub = textOf(out).match(/Subagent started in background\.\s*subagent_id:\s*(\S+)/);
          if (sub) return void (feed.calls ??= new Map()).set(sub[1], u.toolCallId);
          if (feed.held?.has(u.toolCallId)) return;
          endTool(feed, u.toolCallId, u.status === "failed" ? "failed" : "done", out);
          return;
        }
        case "task_backgrounded": {
          (feed.held ??= new Set()).add(u.tool_call_id);
          (feed.calls ??= new Map()).set(u.task_id, u.tool_call_id);
          const it = feed.tools.get(u.tool_call_id);
          if (it) it.status = "running";
          return;
        }
        case "task_completed": {
          const k = u.task_snapshot ?? {};
          const call = feed.calls?.get(k.task_id);
          if (call) {
            feed.held?.delete(call);
            endTool(feed, call, k.status === "failed" || (k.exit_code != null && k.exit_code !== 0) ? "failed" : "done", k.output);
          }
          work(feed).delete(k.task_id);
          return;
        }
        // Grok's whole list of its background commands and monitors, each time it changes.
        case "background_tasks":
          for (const [id, w] of work(feed)) if (w.type === "command" || w.type === "monitor") work(feed).delete(id);
          for (const k of u.tasks ?? []) {
            if (k.status !== "running") continue;
            const monitor = k.kind === "monitor";
            work(feed).set(k.task_id, {
              id: k.task_id, type: monitor ? "monitor" : "command",
              title: k.description || String(k.display_command ?? k.command ?? "").replace(/^\[\w+\]\s*/, ""),
              detail: monitor ? "" : String(k.command ?? "").split("\n")[0], at: Date.parse(k.started_at) || at,
            });
          }
          return;
        case "subagent_spawned":
          work(feed).set(u.subagent_id, { id: u.subagent_id, type: "subagent", title: u.description || u.subagent_type || "Subagent", at, child: u.child_session_id });
          return;
        case "subagent_finished": {
          work(feed).delete(u.subagent_id);
          const call = feed.calls?.get(u.subagent_id);
          if (call) endTool(feed, call, u.status === "completed" ? "done" : u.status === "cancelled" ? "stopped" : "failed", u.output);
          return;
        }
        // A loop: a prompt Grok runs again on a schedule, until it's deleted.
        case "scheduled_task_created":
          work(feed).set(u.task_id, { id: u.task_id, type: "loop", title: String(u.prompt ?? "").split("\n")[0], every: u.human_schedule, next: Date.parse(u.next_fire_at) || null, at });
          return;
        case "scheduled_task_deleted": work(feed).delete(u.task_id); return;
        case "turn_completed": {
          const last = feed.items[feed.items.length - 1];
          if (last) last.closed = true;
          if (u.stop_reason === "cancelled") push(feed, { kind: "note", text: "Stopped" });
          return;
        }
        case "auto_compact_completed": push(feed, { kind: "note", text: "Context compacted" }); return;
      }
    },
  },

  codex: {
    name: "Codex",
    title: "Codex",
    glyph: ICON("codex"),
    tint: (t) => t.blue,
    is: (p) => p?.program?.key === "codex" || /^codex/.test(p?.app ?? ""),
    wanted: (line) => line.includes('"item_completed"') || line.includes('"turn_aborted"'),
    // Codex writes ~/.codex/sessions/<y>/<m>/<d>/rollout-<time>-<id>.jsonl, and its first
    // line names the folder. A terminal's session is the newest rollout for its folder
    // that started after the terminal did. (Two Codex terminals in one folder can't be
    // told apart this way: each shows the newest.)
    async find(info) {
      // Resumed (as a folder change does): its argv names the session.
      const argv = info.argv ?? [];
      const at = argv.indexOf("resume");
      if (at >= 0 && ID.test(argv[at + 1] ?? "")) return newest('"$HOME"/.codex/sessions/*/*/*/rollout-*-"$1".jsonl', argv[at + 1]);
      const r = await exec("/bin/sh", ["-c",
        'for f in $(ls -t "$HOME"/.codex/sessions/*/*/*/rollout-*.jsonl 2>/dev/null | head -40); do ' +
        'printf "%s\\t%s\\n" "$f" "$(head -n 1 "$f" | grep -o \'"cwd":"[^"]*"\' | head -1)"; done']);
      const cwd = info.foreground?.cwd ?? info.cwd;
      const born = (info.created_ms ?? 0) - 60_000;
      for (const line of r.stdout.split("\n")) {
        const [path, field] = line.split("\t");
        if (!path || field !== `"cwd":${JSON.stringify(cwd)}`) continue;
        const m = path.match(/rollout-(\d+)-(\d+)-(\d+)T(\d+)-(\d+)-(\d+)/);
        const started = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : 0;
        if (started >= born) return path;
      }
      return null;
    },
    session: (path) => path?.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/)?.[1],
    resume: (id) => ["codex", ...(id ? ["resume", id] : [])],
    // Each subagent is a session of its own: rollout-<time>-<its thread>.jsonl.
    async subagents(_path, entries) {
      const out = new Map();
      for (const w of entries) {
        w.file ??= await newest('"$HOME"/.codex/sessions/*/*/*/rollout-*-"$1".jsonl', w.id);
        if (!w.file) continue;
        const last = codexStep((await exec("tail", ["-c", "262144", w.file]).catch(() => ({ stdout: "" }))).stdout);
        if (last) out.set(w.id, last);
      }
      return out;
    },
    parse(e, feed) {
      const p = e.payload;
      if (e.type !== "event_msg" || !p) return;
      if (p.type === "turn_aborted") return void push(feed, { kind: "note", text: "Stopped" });
      if (p.type !== "item_completed" || !p.item) return;
      const it = p.item;
      const text = (blocks) => (blocks ?? []).map((b) => b.text ?? "").join("\n").trim();
      switch (it.type) {
        case "UserMessage": { const s = text(it.content); if (s) push(feed, { kind: "user", text: s, at: stamp(e.timestamp) }); return; }
        case "AgentMessage": { const s = text(it.content); if (s) push(feed, { kind: "text", text: s }); return; }
        case "Reasoning": { const s = (it.summary_text ?? []).join("\n\n").trim(); if (s) push(feed, { kind: "thinking", text: s }); return; }
        case "CommandExecution":
          tool(feed, it.id, "Shell", shellCommand(it.command));
          endTool(feed, it.id, String(it.exit_code) === "0" && it.status !== "failed" ? "done" : "failed", it.aggregated_output);
          return;
        case "FileChange": {
          const paths = Object.keys(it.changes ?? {});
          tool(feed, it.id, "Edit", paths.join(", "));
          endTool(feed, it.id, it.status === "failed" ? "failed" : "done", paths.map((f) => `${it.changes[f]?.type ?? "update"} ${f}`).join("\n"));
          return;
        }
        case "McpToolCall":
          tool(feed, it.id, [it.server, it.tool].filter(Boolean).join(" · "), detailOf(it.arguments));
          endTool(feed, it.id, it.status === "failed" || it.error ? "failed" : "done", it.result?.content ?? it.error?.message);
          return;
        case "ContextCompaction": push(feed, { kind: "note", text: "Context compacted" }); return;
        // A subagent: started, given more to do (interacted), or done with it (completed).
        case "SubAgentActivity": {
          const id = it.agent_thread_id;
          if (!id) return;
          const name = String(it.agent_path ?? "").split("/").pop().replace(/_/g, " ") || "Subagent";
          if (it.kind === "completed") return void endTool(feed, id, "done");
          const item = tool(feed, id, "Subagent", name);
          item.at ??= stamp(e.timestamp);
          if (!work(feed).has(id)) work(feed).set(id, { id, type: "subagent", title: name, at: stamp(e.timestamp) });
          item.status = "running";
          return;
        }
      }
    },
  },
};

// A terminal herdr has made a pane for that herdr-core hasn't listed yet: for a moment after
// a tab opens, nothing says what it runs.
export function unlisted(p) {
  return Boolean(p?.terminal) && !p.terminal.includes("/") && !terminals().some((k) => k.address === p.terminal);
}

// The kind of agent a pane runs, when the chat can read it. Until a new agent's own
// process is up, its terminal runs the login shell that starts it (and whatever the
// shell's profile runs): then it goes by what the terminal was started with (its argv), so
// a starting agent is never taken for a shell. Once the agent exits, herdr's launcher
// leaves a plain interactive shell (`zsh -li`) in front: that's a shell again.
export function kindOf(p) {
  if (!p?.terminal || p.terminal.includes("/")) return null;
  const now = Object.keys(KINDS).find((k) => KINDS[k].is(p));
  if (now) return now;
  if (p.program?.agent) return null;
  const k = terminals().find((x) => x.address === p.terminal);
  const front = k?.foreground?.argv ?? [];
  if (front.length === 2 && /^-(li|il|i)$/.test(front[1])) return null;
  const names = (k?.argv ?? []).map((a) => String(a).split("/").pop());
  return Object.keys(KINDS).find((kind) => names.includes(kind)) ?? null;
}
