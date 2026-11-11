# Whitby for Herdr

https://github.com/user-attachments/assets/2cde7bac-219a-4fae-af91-7bd3a1419120

<p align="center">
  <img src="preview.png" width="1136" alt="Whitby for Herdr: a project sidebar of agents in every state, the attention bell, and an agent's terminal with its header and footer">
</p>

A [Herdr](https://herdr.dev) layout that takes its inspiration from [Solo](https://soloterm.com): a
calm, light project sidebar where each agent shows its state at a glance, an attention bell for
the ones that want you, and an agent page with a header and a status footer around the terminal.
It's built from Herdr's own parts (a layout file, one mod and two themes), so your spaces, tabs
and terminals are all still Herdr's.

Version 0.1.0.

## Features

- **Projects sidebar.** Each Herdr space is a project with a folding header, and its tabs sit
  under **Agents** and **Terminals** with counts; hover the Agents count for how many are
  working. A **Filter Projects** field narrows the list. A
  `+` appears on a section's header when you hover it, and an empty section offers to add one.
  The selected row gets a blue bar that slides from row to row.
- **Status dots.** A pulsing green dot means working, green means running, blue means done
  (finished while you were away), grey means idle and light grey means stopped. Solid red is an
  error, pulsing red is blocked on an approval, and pulsing purple needs you (a question, a
  sign-in or no reason given).
- **Agent icons.** Each agent's row starts with its tool's icon, right under the section's
  chevron, as a one-color outline: Whitby draws its own for Claude Code and Codex. An icon is
  faint until its agent has the focus.
- **Nested sub-agents.** Agents an agent starts as terminals (`hc run`) nest under it, as
  herdr's agents list counts them. Hover a parent to fold them; folded, it reads
  "(+2 subagents)".
- **Running subagents.** Work an agent reports about itself has no terminal to list, so its row
  counts what is still running as "+N" on the right: OSC 7501 records, such as Claude Code's
  subagents and Grok's subagents and loop runs. Grok's monitors aren't reported this way, so
  they aren't counted.
- **Unread dots and the attention bell.** An agent that finished, is blocked, needs you or failed
  is unread until you look at it, and carries a small blue dot. The bell in the top-right corner
  counts them; click it to go to the most urgent one.
- **Agent page.** A header with the agent's name and "tool · state", plus Split, Zoom and Close.
  A footer with your own Prev/Next keys, the agent's plan usage, and its tool, sub-agent count,
  CPU, memory and state.
- **Plan usage.** On a Claude, Codex or Grok agent, the footer shows its account's limits as
  thin bars: Claude's five-hour session over its weekly limit, and Codex's and Grok's as they
  report them. Rest the pointer on them for a card with each one's share used and the time until
  it resets. A Grok team seat has no share to show, so it reads "Grok (Team) Cost: $41.91" with
  the session's tokens in its card, as Grok's `/usage` does.
- **Resource badges.** CPU and memory badges on rows and project headers once they cross
  Whitby's thresholds: 30% CPU or 500 MB for an agent, 25% or 1 GB for a project. Hover a row's
  badges for both figures.
- **Readable titles.** It trims what agents add to their titles, such as Grok's " - grok",
  Codex's " | folder" and Muse's bare folder name. While Grok works, its row keeps its last real
  title instead of "Waiting for response...".
- **Projects page.** With no spaces open, the work area shows a Projects page. Its Add project
  row opens a folder picker, and it lists your Herdr shortcuts.
- **Small touches.** The title bar reads "Herdr: Whitby - project - agent". Hovering a project
  header shows Reveal in Finder. The rail buttons and the bell fade on hover. Notifications
  have an X that dismisses them without going to the agent. Light and dark themes follow your
  system appearance.

## Install

Ask your Herdr agent to add `herdr.dev/layouts/shellscape/herdr-whitby`, or copy the files into
Herdr's home yourself:

```sh
git clone https://github.com/shellscape/herdr-whitby
cd herdr-whitby
cp layouts/whitby.json layouts/whitby.svg ~/.config/herdr-app/layouts/
cp themes/whitby-light.json themes/whitby-dark.json ~/.config/herdr-app/themes/
cp -R mods/whitby ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/whitby
herdr-app do layout.switch --name whitby
```

Press `ctrl-shift-l` to cycle back to your own layout. Your layout stays as it was; deleting
these files removes Whitby.

The two theme files matter: the layout names them for light and dark, and the usual
layout-install steps (a layout file plus its mods) don't copy `themes/`.

What the mod does beyond drawing: while the window is in front it runs `ps` every 3 seconds for
the CPU and memory figures, and Reveal in Finder runs `open` on the project's folder.

For plan usage, while an agent of that kind runs it reads the agent's own sign-in and asks only
that agent's provider, at once and then every two minutes:

- Claude Code: the `Claude Code-credentials` login keychain item, read with `security`;
  `api.anthropic.com`.
- Codex: `~/.codex/auth.json`; `chatgpt.com`.
- Grok: `~/.grok/auth.json`; `cli-chat-proxy.grok.com`. On a team seat it also reads
  `~/.grok/active_sessions.json` and the session's `usage.json` every 15 seconds.

Tokens are held only for the request. They are never saved, shown or sent anywhere else, and
never renewed: each CLI renews its own.

## Whitby Chat

A second layout, `whitby-chat`, is Whitby with the agent page as a chat, after Grok Bot's. The
title bar, rail, sidebar, agent header and footer are Whitby's. A Claude Code, Grok or Codex
agent shows as a conversation in place of its terminal: your messages in blue on the right, its
replies in grey on the left as markdown, and its tool calls and reasoning folded into short
chips, one per kind of work: "Ran 2 commands", "Edited 3 files", "Reasoning". Click a chip for
its calls, each with what it ran and a check, a spinner or a cross; click a call for its output.
A call still running has its own chip, "Running · …". Three dots step across while it works.
Every agent's chat is loaded in the background, so clicking one in the sidebar shows it at
once, and the agent bar shows the agent's icon beside its name. A new agent shows a spinner
while it starts. Type in the composer at the bottom: Enter sends, Shift+Enter starts a new line,
and while the agent works the button stops it. A message to an agent that is starting, or
asking something in its terminal, is queued: it shows faded, marked "Queued until Claude is
ready", and goes as soon as the agent is. Under it is the folder the agent works in, by name, with the
full path on hover. Click it between turns to pick another folder: the agent goes on there in
the same tab, resuming its session, and the conversation stays.

The agent still runs in its terminal. The chat reads the session its CLI writes and types your
message into the terminal (`hc send`), as you would. An agent opens on its chat and stays there:
`cmd-`` switches it to its terminal and back, and Whitby never switches on its own.

When the agent asks something in its terminal (Claude's folder trust and its questions, Codex's
approvals, an update offer), the chat reads it off the agent's screen and shows it as a card
above the reply box, whenever the chat shows, also on coming back from the terminal: the
question, a button for each option, and Cancel when Esc cancels. A button moves the agent's
cursor there with the arrow keys and presses Enter, as you would. The screen is read again
right before the keys go: a prompt that changed sends nothing, and the card shows what's there
now. Each prompt is answered once; the card then says "Answer sent. Waiting for the agent."
until the prompt goes. An option that opens
a field ("Type something.") moves there, and the composer types your answer into it. A question
that isn't a menu shows the agent's last lines with ↑, ↓, Enter and Esc, and the composer types
your answer. Messages otherwise go only to an agent at its prompt or at work (`hc send --if`),
never into one of its dialogs. A shell, or an agent the chat can't read, shows its terminal.

In your messages, questions and notes, web addresses and a dialog's links (Claude's "Security
guide") are links: only their words are clickable, and their address shows on hover. Paths
show as inline code. Links in the agent's replies open on a click too, without the hover.

```sh
cp layouts/whitby-chat.json layouts/whitby-chat.svg ~/.config/herdr-app/layouts/
herdr-app do layout.switch --name whitby-chat
```

It needs the rest of Whitby's files (the mod and the themes) installed as above. Merge
`keys.json` into `~/.config/herdr-app/keys.json` for `cmd-``: its `layout:whitby-chat` section
works only while Whitby Chat shows.

What it reads and runs, for each Claude Code, Grok and Codex agent in the window:

- Claude Code: `~/.claude/sessions/<pid>.json` for the session, then that session's transcript
  in `~/.claude/projects/`.
- Grok: `~/.grok/active_sessions.json`, then the session's `updates.jsonl`.
- Codex: the first line of the newest rollouts in `~/.codex/sessions/`, then the one for the
  agent's folder (or, once it has moved folders, the one its session ID names). Two Codex
  agents in one folder both show the newest one.
- Each session's file is found by its ID (`ls`), since a session moved to another folder keeps
  writing to the file it started in.
- `hc get` once every 10 seconds, and `stat` and `tail` on the session file, every 0.6 seconds
  for the agent shown and every 4 seconds for the others, while the window is in front.
- While an agent starts or is blocked, `hc read` of its screen every 0.5 seconds (every 2 for
  agents not shown), and `hc keys` when you answer it.
- It sends with `hc send` and stops with `hc interrupt`. Moving folders opens the agent's CLI
  in the new folder beside it (`terminal.open`) and closes the old one (`pane.close`).

## Develop

```
layouts/whitby.json   the window: title bar, rail, sidebar, and the agent page or Projects page
layouts/whitby.svg    the picture Herdr's settings show for the layout
layouts/whitby-chat.* Whitby Chat: whitby.json with the agent page's terminal in a stack with the chat
themes/               the light and dark themes: Whitby's palette and terminal colors
mods/whitby/          one mod; props.part picks what each block draws
  main.js             picks the part: titlebar, rail, sidebar, header, footer, home, chat, toast
  chat.js             Whitby Chat's conversation and composer, and which of chat or terminal shows
  chat-agents.js      how Claude Code's, Grok's and Codex's sessions are found and read
  chat-screen.js      what an agent asks in its terminal, read off its screen, and how to answer
  kit.js              palette, titles, states, unread, sub-agents, CPU and memory
  sidebar.js          the projects sidebar and its status dots
  titlebar.js bell.js the title bar and the attention bell
  rail.js             the rail and its buttons (and the hover/press layers the bell uses too)
  header.js footer.js the agent page's header and footer
  usage.js            the footer's plan usage: each agent's sign-in, its provider, the bars and card
  home.js             the Projects page
  toast.js            notifications: Herdr's toast with an X to dismiss it
RECIPE.md             the brief Herdr's community format asks for: what to build, exactly
scripts/              the demo
```

### Try it without touching your own Herdr

```sh
scripts/demo.sh          # a second Herdr window with this layout and demo agents in every state
scripts/demo.sh stop
```

The demo has its own Herdr home and its own herdr-core session, so it can't change your spaces,
terminals or settings. The agents are small scripts (`scripts/fake-agent.sh`) that report a
status and nothing else. `DEMO_SIZE=1023x689` sets the window size and `DEMO_SIDEBAR=257` the
sidebar's width; `DEMO_DIR` moves it. Keep that path short, because Herdr talks over unix
sockets inside it. The README screenshot is this demo.

Herdr reloads a mod when you save it. To work on a running demo, edit its copy in
`$DEMO_DIR/app/mods/whitby` (or copy yours over it), then check it and look at it:

```sh
export HERDR_APP_HOME=$DEMO_DIR/app
herdr-app check $HERDR_APP_HOME/mods/whitby
herdr-app shot                                # the window's last frame, as a PNG
herdr-app do layout.switch --name main && herdr-app do layout.switch --name whitby   # start the mod fresh
```

### Things that will bite you

- **Tooltips take the pointer.** On the element that handles hover, `on_hover` never fires; on
  a layer above a button, presses never reach it. Put the tooltip on a wrapper.
- **Transitions need ids.** A fade only runs on an element with an `.id()`, since that's how a
  transition follows it from frame to frame.
- **Hover and press.** On the element that takes the press, a press dragged off and released
  elsewhere never reports the pointer leaving. So hover is tracked on an outer element, and the
  pressed fill is GPUI's own `.active()` style, which ends on a release anywhere.
- **Hit areas.** A block can't draw outside itself, and a hit area hanging past its edge lets the
  pointer leave without the block noticing. Overlay windows are kept back from the window's
  edges, so they can't sit tight in a corner.
- **No nulls.** `.child(null)` breaks a render; use `.children([])` or `.when()`.
- **What herdr gives a layout.** `terminals()` leaves finished terminals out, so a finished
  `hc run` sub-agent can't be shown as stopped.

### Contributing

Issues and pull requests are welcome. Keep [RECIPE.md](RECIPE.md) in step with what the layout
does, since Herdr's agents build from it. Check the mod with `herdr-app check`, and look at the
change in the demo in both light and dark before sending it.

## License

[MPL 2.0](LICENSE). The interface icons in `mods/whitby/icons/` are [Lucide](https://lucide.dev) (ISC,
[LICENSE.lucide](mods/whitby/icons/LICENSE.lucide)). The mark and the platter drawing are
Whitby's own artwork, shared here under the same license.
