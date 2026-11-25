# markdownlint Integration Evaluation

Status: complete. All four phases shipped (2026-11-24 to 2026-11-25); per-phase notes below.

Phase 1 status: shipped (worker, controller, `Outline | Lint` tabs, app profile, master toggle).

Phase 2 status: shipped 2026-11-24. Settings dialog (gear, `Ctrl+,`) with General and Linting pages, schema-generated rule browser, presets, `lint` settings `{ enabled, preset, rules, debounceMs, largeFileKB }`, and read-only `.markdownlint.json(c)` discovery with relative `extends`. Deviations: project configs are read-only (no JSONC editing yet), "Show inline markers" and the Editor page are not built, and the discovery walk stops at the Folder Browser root only when that root is locked, because an unlocked root follows the active file's folder.

Phase 3 status: shipped 2026-11-25. Hybrid gutter marks and active-block underlines with a Fix tooltip, Visual block decorations, floating-rail problem ticks, `Show Inline Markers`, per-problem `Fix` and `Fix All` (Source undoable, Visual behind a confirmation). Deviations: underlines and tooltips use a small custom CodeMirror decoration instead of `@codemirror/lint` to keep the dependency set unchanged and the code in the lazy chunk; Source has no underlines.

Phase 4 status: shipped 2026-11-25. BBCode export warnings as a `BBCode (Nexus | Steam)` Lint group in a second lazy worker (conversion measured at 0.6 s for 50 KB and 2.4 s for 100 KB, so never on the main thread; capped at 100 KB), with `Include BBCode Export Warnings`; on-demand, cancellable Folder audit (500 files, 2 MB each) grouped per file with click-to-open. Deviations: warnings are mapped to lines by converting each top-level block alone (the converter itself reports no positions), and warnings no single block produces show without a line; no folder tree badges, as planned.

## Recommendation

Do it, as an **opt-in, lazy-loaded linter that runs in a Web Worker**. Built that way it costs **nothing at boot or close** when the Lint tab has never been opened, and when it is on, typing never waits on it. Doing it the naive way (bundled into `main.js`, linting synchronously on every `capture()`) would cost startup time and visibly lag typing in anything over ~20 KB, so the architecture below is the part that matters.

Effort: medium. Roughly three pieces of similar size: (1) worker + lint engine plumbing, (2) right sidebar `Outline | Lint` tabs and a Problems list with Source/Hybrid markers, (3) a real Settings dialog with a rule browser. Visual-mode markers and quick fixes are the hardest part and can ship later.

## Measured cost

markdownlint 0.42.2 (current), bundled with esbuild exactly as Vite would. Timings are from a 4 vCPU cloud container on Node 22 (same V8 family as WebView2); a desktop CPU should be equal or faster. For scale, the app's existing `marked.lexer` parses 100 KB in **9.6 ms** on the same machine.

### Size and memory

| What | Size |
|---|---|
| Current app bundle (`dist/assets/index-*.js`) | 1,494 KB min |
| markdownlint browser bundle | **289 KB min / 91 KB gzip** (+19 % if bundled eagerly) |
| of which `re2js` (ReDoS-safe regex, core dependency, cannot be stripped) | 150 KB |
| of which micromark parser + GFM/math/directive extensions | ~70 KB |
| `@codemirror/lint` (gutter + underline UI, optional) | 15 KB min / 6 KB gzip |
| Heap after import / after linting | +2.1 MB / +3.6 MB |
| Dedicated worker isolate in WebView2 (estimate, not measured) | ~3 to 8 MB extra |

The package is local, so download size is irrelevant. What matters is parse/compile time on the main thread, which is avoided entirely if the code only loads inside a worker chunk.

### Startup

| Scenario | Cost |
|---|---|
| Module load + evaluate | **~55 ms** |
| First lint (cold JIT, 10 KB doc) | **~85 to 95 ms** |
| Eager import in `main.js` | +55 ms on every launch, plus parse of 289 KB. Not acceptable for this app. |
| Dynamic `import()` inside a worker, started only when linting is enabled, after first paint (`requestIdleCallback`) | **0 ms on the boot critical path** |
| Lint disabled (default) | 0 ms, the chunk is never fetched |

Close: no cost. The worker is terminated with the window; there is nothing to flush.

### Per-lint cost (whole document; markdownlint has no incremental mode)

| Doc size | Lines | Median | p90 |
|---|---|---|---|
| 5 KB | 109 | 17.5 ms | 23 ms |
| 20 KB | 554 | 38 ms | 52 ms |
| 50 KB | 1,708 | 104 ms | 131 ms |
| 100 KB | 3,630 | 212 ms | 276 ms |
| 250 KB | 9,206 | 523 ms | 566 ms |
| 500 KB | 18,687 | 1,243 ms | 1,434 ms |

Roughly 2 ms per KB, about 20x a `marked` lex. Turning off the heaviest rules (MD013, MD044) only saves ~10 %. The cost is the micromark parse, not the rules.

**Conclusion:** at a 16 ms frame budget, linting on the main thread would drop frames on every keystroke for anything but tiny files, and a 100 KB guide would stall typing by a fifth of a second. In a worker it is free for typing: the main thread only posts a string and renders a short list.

## Architecture

1. **`src/lint/lint-worker.js`** (Vite `new Worker(new URL(...), { type: 'module' })`, its own chunk). Imports `markdownlint/sync` lazily on first message. Receives `{ docId, revision, text, config }`, returns `{ docId, revision, results }`.
2. **`src/lint/lint-controller.js`** on the main thread:
   - Does nothing until linting is enabled; then spawns the worker on idle after startup.
   - Hooks into `capture()` next to `documentOutline?.refresh()`. **Debounce 400 ms after the last keystroke**, with a max-wait of ~2 s so a long typing burst still updates.
   - Latest-wins: drop responses whose `revision` is stale; never queue more than one pending lint per doc. If a lint is running, set a dirty flag and lint again when it returns.
   - Lint the active document only. Background tabs are linted when activated, never in a loop.
   - Size guard: above ~300 KB, switch to lint-on-save/on-demand with a "Large file, click to lint" row.
   - Pause while the Lint tab is hidden *and* inline markers are off.
3. **Frontmatter**: pass the app's frontmatter handling through (`frontMatter` option, default regex works) so YAML is skipped. Line numbers then still match the full source.
4. **Showing results per mode**
   - **Source**: `@codemirror/lint` diagnostics (wavy underline, gutter dot, hover with rule id and Fix). Map `lineNumber`/`errorRange` to offsets.
   - **Hybrid**: map lines to `hybridView.blocks` spans; mark the rendered block with a left-edge tick, and inside the active CodeMirror block use the same diagnostics as Source.
   - **Visual**: Tiptap has no stable line mapping, and Visual serialization can normalize Markdown. Mark the enclosing top-level block only (like OpenKnowledge's WYSIWYG block marking), via the same block segmentation `segmentMarkdown` already produces. Phase 2.
5. **Quick fixes**: markdownlint returns `fixInfo`; `applyFix`/`applyFixes` produce new source. In Source and Hybrid apply as a CodeMirror transaction (keeps undo). In Visual, a fix means reloading the editor from source, which resets undo (editors are recreated on load per AGENTS.md), so offer "Fix all" there only behind a confirmation, or only in Source/Hybrid.

### App-specific rule defaults

The app's own dialect trips several stock rules. Ship a default profile that is quiet out of the box:

| Rule | Why | Default |
|---|---|---|
| MD033 no-inline-html | `<span style="color:…">` is how colors are stored | allow `span`, `center`, `details`, `summary` (via `allowed_elements`) |
| MD013 line-length | Prose files, soft wrap | off (also VS Code's default) |
| MD041 first-line-heading | Many Nexus pages start with an image or text | off |
| MD028 no-blanks-blockquote | Separate adjacent callouts | keep, review |
| MD024 no-duplicate-heading | Changelogs repeat "Fixes" etc. | `siblings_only: true` |
| `\|\|spoiler\|\|` | Not standard Markdown; no rule should fire, verify MD055/MD056 table pipes don't misfire | test |
| Callouts `> [!note]` | Fine with stock rules; verify MD027/MD028 | test |

Optional later: a custom rule for BBCode export lint (e.g. Steam `h4`+ downgrade, color under Steam) so warnings that today appear only at export also show in the Lint tab. That would reuse `steam-bbcode.js` warnings rather than markdownlint.

## UI sketch

### Right sidebar: `Outline | Lint` tabs

Today the right side is a three-state Outline (`Off / Float / Dock`) driven by `outline.js`. Proposed:

- The docked pane gets a tab strip in its header: **Outline** and **Lint (n)**, with a count badge (amber for warnings, red for errors). Same `Off / Float / Dock` switch controls the whole pane; the tab choice is persisted as `rightPanelTab` in `session.json` next to `outlineMode`.
- The floating rail keeps Outline ticks; add small amber/red tick marks on the rail at the vertical positions of problems so issues are visible without opening the pane.
- **Lint tab contents** (following OpenKnowledge's Problems tab):
  - Rows: severity icon, `MD022` code, short description, `Ln 42`. Repeated hits of one rule collapse into a single row with a `×5` count, expandable.
  - Click a row: scroll to and select the range (reuse the outline's jump-to-heading plumbing).
  - Row actions: **Fix** (if fixable), **Disable rule** (writes to settings), **Docs** (opens the rule's upstream page via the existing validated external-link opener).
  - Header: `Fix all` (fixable only), filter (Errors / Warnings), and a refresh button.
  - Empty state: "No problems" with a check icon; disabled state: "Linting is off. Enable in Settings."
  - Scope: **This document only**. OpenKnowledge's on-demand "Project" audit could map to the Folder Browser root later, run only on click, never in the background.
- Folder Browser (optional, later): amber/red count badge on open files that have problems. Only for files already linted (open tabs), never by scanning the folder, to keep the sidebar fast.

### Settings dialog (new; the app has none today)

Settings currently live as scattered header toggles persisted in `session.json`. A real dialog would be a modal (same backdrop as Diff View) opened from a gear button and `Ctrl+,`, with a left nav:

- **General**: existing globals moved or mirrored here (BBCode target, Width, Outline mode, Files sidebar on launch, update checks).
- **Editor**: default mode (Visual/Hybrid/Source), color format.
- **Linting**
  - Master toggle: *Enable Markdown linting* (default off).
  - *Show inline markers* (Source/Hybrid underlines; Visual block marks).
  - *Lint delay* (ms, default 400) and *Large file threshold* (KB).
  - *Config source*: `App defaults` or `Use .markdownlint.json(c) found next to the document / in the opened folder root` (OpenKnowledge behavior; nearest file walking up wins). When a project file is in use, the rule browser edits that file instead of app settings and says so.
  - **Rule browser** (the OpenKnowledge pattern, generated from `markdownlint/schema/markdownlint-config-schema.json`, so it stays in sync with the engine on upgrade):
    - Search by id, alias or description; category filter (Headings, Lists, Whitespace, Code, Links & images, Style) from the rule `tags`; "Only modified" checkbox.
    - Per rule: on/off toggle, severity (Warning / Error), typed editors for each option from the schema (number, boolean, enum dropdown, string list), "Reset", and a docs link.
    - Presets dropdown: `App default (Markdown BBCode)`, `markdownlint default`, `Relaxed` (bundled `style/relaxed.json`).
  - Storage: app-level rules in `settings.json`/`session.json` under `lint`, in `portable-data` or `%APPDATA%` like other settings. JSONC edits to project files should be minimal to keep comments; YAML/`.cjs` configs read-only with a notice (OpenKnowledge does the same).

The schema JSON is ~160 rule/option entries and only needs to load when the Linting page opens, so it is lazy-loaded too.

## Risks and open questions

- **Hybrid line mapping**: line numbers must be computed against the whole document source while only one block is a live CodeMirror; needs a block-offset table (already implied by `segmentMarkdown` spans).
- **Visual normalization**: lint runs on the saved source; after a Visual edit the serialized Markdown can change shape, so markers can briefly point at stale blocks until the next lint returns. Acceptable with the 400 ms debounce.
- **Worker in Tauri/WebView2**: module workers are supported, and the existing CSP in `tauri.conf.json` (`script-src 'self'`, which `worker-src` falls back to) already allows a same-origin worker chunk. No CSP change needed.
- **Upgrades**: markdownlint is ESM-only and moves fast; pin the version like the rest of the lockfile.
- **Tests**: unit tests for the controller (debounce, stale-revision drop, size guard) under `node --test`; Playwright for tab switching and click-to-jump. Startup budget should be guarded by a test that asserts the lint chunk is not requested at boot with linting off.

## Suggested phases

1. Worker + controller + Lint tab (list, counts, click-to-jump), Source-mode markers, app default profile, master toggle. *Delivers the feature with zero boot cost.*
2. Settings dialog with General + Linting pages and rule browser; `.markdownlint.json(c)` discovery.
3. Hybrid/Visual block markers, quick fixes, floating-rail problem ticks.
4. Optional: BBCode export warnings as lint rules; on-demand folder audit.

## Sources

- markdownlint 0.42.2 package and schema (measured locally).
- OpenKnowledge docs: [markdownlint support (blog)](https://open-knowledge-docs.preview.inkeep.com/blog/markdownlint-support), [Content rules: markdownlint](https://open-knowledge-docs.preview.inkeep.com/docs/advanced/content-rules/markdownlint), [Content rules overview](https://open-knowledge-docs.preview.inkeep.com/docs/advanced/content-rules/overview), [Editor features](https://open-knowledge-docs.preview.inkeep.com/docs/features/editor).
