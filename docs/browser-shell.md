# The browser terminal

`/shell.html` returns to the central idea: the small self-reading Bash program
**is** the coding agent. The web UI supplies a terminal, files and model transport.
No JavaScript orchestration loop replaces the Bash loop. The default source is
loaded verbatim from `/shprout.txt`; optional compression generates another Bash
file, gates it, and makes it available to run in the same terminal.

## Execution

- GNU Bash 5.0.3 from a Debian x86 image runs inside CheerpX 1.2.8 WebAssembly.
- xterm.js receives actual guest console output and forwards keyboard input.
- Native jq 1.8.2 is bundled because the base image does not contain jq.
- The shell's `curl` executable is a small Python transport adapter. Requests
  travel over a private OSC record to the page, then a response file back to
  the guest through DataDevice. The only external API destination is the
  Pollinations chat endpoint. API credentials never enter the guest.
- The canonical script still performs self-read, JSON construction, curl,
  unfencing, eval and cumulative history itself.
- Linux files persist in this origin's IndexedDB. Refresh restarts processes and
  installs the displayed source; the filesystem remains. Edits made to the
  source inside a running shell persist until the page explicitly installs a
  new source or reloads.
- The just-bash option runs wholly in JavaScript with a virtual filesystem and
  buffered command output. It is a subset, not a full native Linux runtime.

## Verified and limited

A browser integration run executed the unchanged script, checked that the model
request contained its source, evaluated arithmetic to `42`, executed native
Python to produce `56`, and used native jq to produce `7`. The following request
contained the computed history. Manual text input executed Bash commands in the
same console. Editing source changed the executed file. The optional compressed
prompt path generated and gated a replacement, which then executed successfully
and stopped on exit in browser Linux. DataDevice source transfers use fresh file
names because the device only creates new files. Model responses in integration tests are mocked; shell execution
is real.

The guest's synthetic `/dev` filesystem is read-only and lacks `/dev/fd`.
Process substitution currently fails. The runtime description tells the agent
to use pipes or temporary files. GNU Bash syntax does not guarantee every Linux
syscall or command works under emulation. General networking is disabled; the
curl adapter only supports model calls. The canonical loop remains bounded at
20 turns; the browser transport also caps model calls, and the task button sends
an interrupt after 90 seconds. Interrupt/reset is available in the UI.

## Serving and dependencies

The web server only serves static assets; it does not execute shell commands.
`npm run dev` sends COOP `same-origin` and COEP `require-corp` on `/shell.html`.
HTTPS (or localhost) and these headers are required. Static hosts must configure
the same headers themselves; a plain GitHub Pages deployment cannot assume them.

The VM loads an immutable runtime from
https://cxrtnc.leaningtech.com/1.2.8/cx.esm.js and disk blocks from the documented
WebVM Debian image. Consult https://cheerpx.io/docs/getting-started and the
runtime's licensing terms before public/commercial hosting. jq provenance and
license are under `web/linux/`. No PTY backend or desktop CLI is involved.

## Presets and their history

The page now follows the experiment in order: compressed prompt → uncompressed
Bash source → task → terminal output. All three inputs are editable. Generating
replaces the source only after the basic execution gate passes; selecting a
saved source is independent of the compressed prompt. Drafts and selections
survive the authorization redirect, shell restart, and runtime switch.

`web/shell-presets.js` records the provenance for each selection:

- Seven compressed prompts: the five compression-search seeds already restored
  in `seed-runtime.js`, plus the exact brevity and think-and-golf prompts from
  `archive/compress-bench-2026-07-09:compress/results/results.json`.
- Six Bash harnesses: current shprout (the unfence lineage), classic (main and
  self-recurse), capped system/user history (unfence-syscap), self-modification
  (self-mod), the saved compression champion, and the exact 564-byte Opus v5
  sample from the polli-pipe experiment under the compress-bench archive.
  The first four are the current browser-compatible repository profiles, not
  claims of byte-identical archived snapshots. The Opus sample is copied
  verbatim to `research/compression/samples/opus-v5-564B.sh`.
- Eight task prompts: the two current terminal showcases and six micro-bench
  tasks ported from compress-bench. The hash task uses `sha256sum` in place of
  the archived macOS `shasum` command.

Also inspected the webcontainer and polli-webcontainer archives. Their DOM,
Node and CLI harnesses require different execution contracts and are not Bash
presets. The earlier 395-byte Opus sample expects a task **file** and lacks an
exit check, so it is not offered as a drop-in `$1` task-string harness. The
original syscap script needs `/dev/fd` process substitution; its existing port
under `approaches/syscap` is used instead. Historical sample pass counts describe
those samples, not guaranteed outcomes for new generations.

The self-modification preset deliberately reuses `.shprout/self-mod` after its
first run. Its editor shows the repository launcher; use the terminal to inspect
the writable identity and its later edits. The page explicitly notes this.

A single collapsed **Inspect model prompt** section shows the latest model
request's settings and messages. It reflects the history assembled by the Bash
script, rather than maintaining a second agent history in JavaScript. During
generation it shows the compressed prompt. There is no separate session recorder,
comparison dashboard, or run-export flow on this page.

The Model field applies to both **Generate agent** and **Run shprout**. Its
suggestions come from Pollinations' live text-model catalogue; an exact model ID
can also be typed. The choice survives authorization and reload. Each Run passes
the selected value as the script's `MODEL` environment variable in either runtime;
the Bash harness still assembles its own request. You can change the selection
between generating and running. Manually typed terminal commands use the shell's
own environment (initialized with the selected model at boot).
