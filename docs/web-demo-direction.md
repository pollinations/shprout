# One shprout demo

Reviewed 2026-09-10 against `981812c`, current uncommitted changes, refreshed
origin refs, and all five `archive/*` tags. Origin currently has two branches:
`main` and `codex/just-bash`. The other approaches survive in tags and ancestry.

The strongest starting story is **a short description grows a Bash agent, and
that agent draws its own loop in the terminal**. Use Seed as the entry point,
keep the actual Bash and observations inspectable, and put experiments behind
one optional disclosure. Thomas prefers terminal output for this first version.

## What to combine

| Lineage | Evidence | Contribution |
| --- | --- | --- |
| main / self-recurse | `2fc88d2`, `4f385cf`, `87c639d` | Legible self-read → task → model → eval → observation loop. |
| unfence | `c9eae10`–`64fef74`; current `shprout` | Reasoning separate from executable Bash; command errors become observations. |
| prompt-compression / compress-bench | `918b724`, `8971f87`, `45257c3`, `b099391` | Generate actual harness source from an editable prompt; test execution before live use; retain failed attempts. |
| just-bash / Workshop | `ca55071`, `a60c4bc`; `web/workshop.js` | One browser shell, virtual files, isolated artifact preview, locally bundled dependencies. |
| jsprout / DOM / Arena | `9de9dd9`, `da18437`, `8e7ab94` | A visible payoff and optional same-task comparison. Start with a terminal self-portrait; retain the DOM renderer as a separate experiment. |
| syscap | `archive/unfence-syscap-2026-07-09`; `approaches/syscap` | Optional comparison for context cost; bounded history while keeping identity and task. |
| self-mod | `archive/self-mod-2026-07-09`; `approaches/self-mod` | Later experiment: source edit visible on the next turn. Do not imply that editing a loaded Bash file hot-reloads its control flow. |
| polli / WebContainer / Node / Lisp | archived branches and `approaches/lisp` | Preserve authentication ergonomics and local experiments. Native Node processes and Lisp images cannot be combined faithfully with just-bash. |

## Main interaction

```text
Describe the agent [editable seed, measured bytes]
Give it a task     [draw itself / terminal garden / your own words]
                  [Grow it and run it]

Terminal
[actual generated Bash, expandable]
[command the model returned]
[what the shell printed, including the full self-portrait]
[stop reason, measured bytes and calls, download agent.sh]

Under the hood: checks, alternate seeds, code vs prompt, sabotage
```

The shell output is the focal point. Keep the existing green/paper shell: paper
`#f3f5f2`, panel `#ffffff`, ink `#18211b`, green `#246a47`, terminal `#17201a`.
Use the existing system sans for controls and monospace only for source and
terminal output. Left-align labels; distinguish commands from printed output.
Keep source collapsed initially and preserve ASCII spacing with horizontal
scrolling on narrow screens.
No decorative animation or prebuilt example presented as agent output. Reuse the
existing visual vocabulary so this becomes the main demo rather than a fourth lab.

## What the evidence actually supports

- The historical “386 B” seed is 386 JavaScript characters but **388 UTF-8
  bytes** in the current catalogue (`≤` costs three bytes). It passed one of
  two historical generations. The 396-character variant passed two of two;
  neither sample size establishes a general success rate.
- The selected generated agent passed six historical micro-tasks. Both it and
  the reference later scored **0/10** on the sampled Terminal-Bench tasks.
- Prompt → source is generative reconstruction using knowledge in the model,
  not lossless compression. The separate code-versus-seed experiment changes
  the running agent's self-description. Measure request bytes and task outcome;
  do not present the source/seed ratio as token savings or a quality score.
- The browser runs Bash semantics through just-bash, not a native Linux VM.
  Model inference still happens at Pollinations. HTML/JS written by Bash runs
  in a separate sandboxed preview iframe.
- A three-reply gate is a smoke test, not a proof of safety, universal Bash
  compatibility, or task quality. A visual artifact existing is not evidence
  that it looks good or meets the requested interaction.

## Findings in the latest changes

The uncommitted Seed implementation already supplies generation, gate, live
execution, typed tasks, self-description comparison and run caps. The latest
commits supply dependency bundling and the consolidated runtime. The following
gaps matter more than merging additional harnesses:

1. The default task prints a number. A finite terminal self-portrait better
   explains what is unusual about this agent; no preview pane is needed yet.
2. Several seed descriptions state historical observations as universal facts.
   “Zero servers” and “nothing ran outside this tab” also omit remote inference.
3. The seed remains editable during a run, and editing generated code leaves an
   old passing gate enabled. Both undermine the association between input,
   checked script and displayed result.
4. File refresh compares lengths, so same-length edits are invisible.
5. Generation is not covered by the execution Stop button or 90-second cap.
6. In comparison mode one shared AbortController stops both lanes if either
   hits its cap. Request-byte measurement excludes retried request traffic.
7. Arbitrary generated scripts invent logging protocols; shell-output recovery
   is heuristic. A script can also swallow API errors and appear to finish.
8. Regex self-image substitution is limited to common `$0` spellings. Validate
   the actual request when comparing; a “none” option is not proof the model
   could not subsequently read the source file.
9. `web/build.js` uses root-relative URLs, so project-subpath hosting needs URL
   handling. Its output-directory deletion also needs a guard before broad use.

The accompanying changes address 1–4, make Seed the root page, remove the
artificial code-reveal delay, and add a download of the actual generated script.
A later pass (2026-09-23) closes 5, the lane half of 6 and the guard half of 9:
generation now has its own controller wired to Stop and the 90-second cap;
each comparison lane has its own controller, so one lane's call cap no longer
cuts the other short (Stop and the time cap still end both); and `buildSite`
refuses to delete the filesystem root, home, the repository or its parents, or
an existing directory without a previous build's `.nojekyll`.
The browser Linux shell also sends console input as UTF-8 bytes; sending code
points stalled any task containing non-ASCII text at an unterminated quote. Still open:
retried bytes in request measurement, 7, 8 and subpath hosting.
The remaining items are follow-up engineering, not claims this iteration solves.

## Evaluation before sharing widely

Keep the inexpensive deterministic gate and file-based fixtures. Exercise the
real browser pipeline with intercepted model replies for integration testing,
explicitly separate from live inference. No replay mode in the public product.

For live quality evidence, generate several agents per seed, run the same held-out
tasks with code/seed/no self-description in independent filesystems, and retain
all attempts, model identifiers, source, outcomes, requests, latency and stop
reasons. Hold the runtime and run model constant. Count generation failures
separately from task failures. Visual checks should report artifact creation and
browser errors separately from human preference, not invent an objective winner.

Keep Pollinations sign-in with no client ID, host-side credentials, editable
agent and task prompts, explicit stop states, and downloads of actual output.
Public links configure a new run; they do not reproduce the original outcome.

## Verification of this iteration

- Restored dependencies with `npm ci` using the existing lockfile; the initial
  test failures were missing dependencies after disk cleanup.
- `npm test`: 60 passing, one skipped (the local SBCL integration), no failures.
- `node web/build.js`: 27 static route files emitted; the root serves Seed and
  `/experiments.html` retains the other approaches.
- Browser integration using `test/browser-fixture.mjs`: generated-source
  extraction, real just-bash gate, two-call terminal execution, measured source
  size in output, neutral completion, locked seed during generation, and
  invalidation of the passing gate when the source is edited. No console errors.
- Inspected the main page and custom-task input in the browser. A requested
  viewport override did not take effect, so this is not a verified mobile pass.
- No live Pollinations inference was performed in this review. The fixture
  server is separate from production routes and explicitly labels its replies
  as scripted. The public demo retains the live sign-in flow.
