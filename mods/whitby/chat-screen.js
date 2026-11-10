// What an agent is asking in its terminal, read off its screen (`hc read`), so the chat can
// show it and answer it. Agents ask in menus: a question, options with one under the cursor
// (❯ or ›), and a footer naming the keys ("Enter to confirm · Esc to cancel"). Claude Code's
// folder trust and its questions, and Codex's approvals and update offer, all look so.
//
//   readDialog(screen) → { question, options: [{ label, detail, free }], selected, esc, auto } | null
//
// `free`: an option that opens a field to type in ("Type something."). `auto`: the seconds
// left before the agent goes on without your answer, while it counts down, else null. Answering moves the
// cursor with the arrow keys and presses Enter (answerKeys), never the option's number:
// Codex can read a number as a different answer.

// The footer: Enter or Esc, and what they do.
const FOOTER = /\b(enter|esc)\b[^\n]*\b(confirm|select|continue|cancel|skip|navigate)\b/i;
// The cursor: a marker, then the option.
const CURSOR = /^(\s*)([❯›▶➤>])\s+(\S.*)$/;
const NUMBERED = /^(\d+)[.)]\s+(.+)$/;
const RULE = /^\s*[─━═—–-]{6,}\s*$/;
// Lines that belong to the conversation above a dialog, not to its question: the agent's
// bullets and your echoed message.
const TRANSCRIPT = /^\s*[•⏺❯›>⎿]/;
const FREE = /^(type something|other)\b/i;
// Claude Code's questions can go on without you (its askUserQuestionTimeout setting): in
// their last seconds a line under them counts down ("auto-continue in 12s · any key to stay").
const AUTO = /\bauto-continue in (\d+)s\b/i;

// Box borders become spaces, so columns still line up.
const clean = (line) => line.replace(/[│┃╭╮╰╯]/g, " ").replace(/\s+$/, "");
const column = (line) => line.search(/\S/);

export function readDialog(screen) {
  const lines = (screen ?? "").split("\n").filter((l) => !l.startsWith("[hc]")).map(clean);
  let foot = -1;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 12); i--) {
    if (FOOTER.test(lines[i])) { foot = i; break; }
  }
  if (foot < 0) return null;
  // The cursor nearest above the footer (your echoed message can carry the same marker).
  let cur = -1;
  for (let i = foot - 1; i >= Math.max(0, foot - 40); i--) {
    if (CURSOR.test(lines[i])) { cur = i; break; }
  }
  if (cur < 0) return null;
  const m = lines[cur].match(CURSOR);
  const col = lines[cur].length - m[3].length;
  const numbered = NUMBERED.test(m[3]);
  // An option: the cursor's line, or a line starting where its text does; numbered like
  // it, when it is.
  const isOption = (i) => {
    if (i === cur) return true;
    const line = lines[i];
    if (!line.trim() || RULE.test(line) || column(line) !== col) return false;
    return numbered ? NUMBERED.test(line.slice(col)) : true;
  };
  // The menu runs up from the cursor through options and their (deeper) details. Agents
  // put blank lines between a dialog's parts.
  let start = cur;
  for (let i = cur - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (RULE.test(line)) break;
    if (isOption(i)) { start = i; continue; }
    if (column(line) > col) continue;
    break;
  }
  while (start < cur && !isOption(start)) start++;
  const options = [];
  let selected = 0;
  for (let i = start; i < foot; i++) {
    const line = lines[i];
    if (!line.trim() || RULE.test(line)) continue;
    if (isOption(i)) {
      const text = (i === cur ? m[3] : line.slice(col)).trim();
      const label = text.replace(NUMBERED, "$2").trim();
      if (i === cur) selected = options.length;
      options.push({ label, detail: "", free: FREE.test(label) });
    } else if (options.length && column(line) > col) {
      const last = options[options.length - 1];
      last.detail = [last.detail, line.trim()].filter(Boolean).join(" ");
    }
  }
  if (!options.length) return null;
  // The question: what stands above the menu, up to a rule or the conversation, its blank
  // lines left out.
  const asked = [];
  let gap = false;
  for (let i = start - 1; i >= 0 && asked.length < 8; i--) {
    const line = lines[i];
    if (!line.trim()) { gap = true; continue; }
    if (RULE.test(line) || TRANSCRIPT.test(line)) break;
    asked.unshift({ text: line.trim().replace(/^[☐☑□■]\s*/, ""), gapBelow: gap });
    gap = false;
  }
  // The terminal wraps long sentences: a long line that doesn't end one, with no blank line
  // after it, goes on in the next.
  const question = [];
  asked.forEach((line, i) => {
    const prev = asked[i - 1];
    if (prev && !prev.gapBelow && prev.text.length >= 60 && !/[.:?!]$/.test(prev.text)) question[question.length - 1] += ` ${line.text}`;
    else question.push(line.text);
  });
  const auto = lines.slice(foot + 1).map((line) => line.match(AUTO)).find(Boolean);
  return { question: question.join("\n"), options, selected, esc: /\besc\b/i.test(lines[foot]), auto: auto ? Number(auto[1]) : null };
}

// Words in agents' dialogs that are links in their terminal: the screen keeps the words
// and drops where they point, so the chat knows the ones it shows. Claude Code's folder
// trust links "Security guide" to its security page.
export const LINKS = { "Security guide": "https://code.claude.com/docs/en/security" };

// The keys that pick option `to` from the cursor's: arrows, then Enter (none for a free
// option, whose field you type into next).
export function answerKeys(dialog, to) {
  const moves = to - dialog.selected;
  const arrows = Array(Math.abs(moves)).fill(moves > 0 ? "down" : "up");
  return dialog.options[to].free ? arrows : [...arrows, "enter"];
}

// The screen's last lines, for a question that isn't a menu (a yes/no line, a field).
export function screenTail(screen, count = 12) {
  const lines = (screen ?? "").split("\n").filter((l) => !l.startsWith("[hc]")).map(clean).filter((l) => l.trim() && !RULE.test(l));
  return lines.slice(-count).join("\n");
}

// The agent's slash-command menu, read off its screen while you type a command: its rows
// (name, what it does, whether it's the picked one), as Claude Code, Codex and Grok draw them
// just above their input (Claude Code and Grok across a rule, Grok's input in a box, Codex's
// with blank lines between). A row is a name, an alias in brackets (Claude Code's) and what
// it does, two spaces on (one after a name cut short with "…", Grok's); what it does can run
// on in lines indented under it. Empty when no menu shows.
const PROMPT = /^\s*(?:│\s*)?[❯»]\s+\/\S*$/;
const EDGE = /^[\s─╭╮╰╯│]*$/;
const ROW = /^\s*([❯›])?\s*(\/\S*…(?=\s)|\/\S+(?:\s\([^)]*\))?(?=\s{2}))\s+(\S.*)$/;
const MORE = /^\s{8,}\S/;

export function readPalette(screen) {
  const lines = (screen ?? "").split("\n").filter((l) => !l.startsWith("[hc]")).map((l) => l.replace(/[\s█▐▌│]+$/u, ""));
  let i = lines.length - 1;
  while (i >= 0 && !PROMPT.test(lines[i])) i--;
  if (i < 0) return [];
  i--;
  while (i >= 0 && EDGE.test(lines[i])) i--;
  const end = i;
  while (i >= 0 && (ROW.test(lines[i]) || MORE.test(lines[i]) || (!lines[i].trim() && i > 0 && ROW.test(lines[i - 1])))) i--;
  const rows = [];
  for (const line of lines.slice(i + 1, end + 1)) {
    if (!line.trim()) continue;
    const row = line.match(ROW);
    if (row) {
      const name = row[2].split(" ")[0];
      rows.push({ name, about: row[3].trim(), picked: Boolean(row[1]), cut: name.endsWith("…") });
    } else if (rows.length) rows[rows.length - 1].about += ` ${line.trim()}`;
  }
  return rows;
}
