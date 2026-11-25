# Changelog

## Unreleased

1. Added a `Theme` choice (Auto, Light, Dark) at the top of Settings › General. It is applied through the native window theme, so the title bar matches and WebView2's `prefers-color-scheme` follows without CSS changes. The choice is kept in `appearance.json` beside the other app data and read by Rust before the window is built, so a forced theme shows from the first frame with no flash.

1. Added a Drafts list: the `Drafts` button now opens a panel under it instead of reopening every draft at once. Each row shows the draft's name and first line of text, opens it on click and has its own `Delete`, with `Delete All` at the bottom (`src/drafts-panel.js`, a 3 KB lazy chunk). Deleting happens at once and offers `Undo` in a toast for 10 s, which puts the drafts back where they were.
2. Added a right-click menu on tabs with `Close` and, for unsaved drafts, `Discard Draft`, which closes the tab and deletes the draft at once with `Undo` in a toast (Undo reopens it as the active tab).
3. Added the app's shared toast stack (`src/toasts.js`, bottom right; hovering pauses every timer, clicking dismisses) and a shared pointer menu (`src/popup-menu.js`) now also used by the Folder Browser's context menu.
1. Fixed switching from Visual to Hybrid (and back) jumping to the top of the document: the block at the top of the view now stays at the same spot and gets the caret. Switches to or from Source keep the same relative scroll position.
1. Changed Hybrid to hide blank lines like Visual: the blank line between two blocks is now a paragraph-sized gap that still opens for editing on click, and leading, trailing or repeated blank lines take no height. Source still shows every blank line, and nothing changes on disk.
1. Fixed `Alt+Up`/`Down` in Visual mode moving a neighbouring divider (`---`) instead of the block under the caret: the editor's own arrow handling selected the divider first. Moves now read the caret before that. Hybrid, `Move Up`/`Down` and drag and drop were not affected.
1. Changed the portable deploy (`npm run portable`, `Build-Portable.cmd`) to close a copy running as administrator instead of aborting: after one UAC prompt, an elevated helper sends the same `--graceful-close` request and `WM_CLOSE` fallback, still with a 10 s limit that aborts cleanly on a save or conflict dialog. The new exe is now staged beside the old one and swapped in with a retried rename, and the relaunch stays non-elevated. The Playwright suite limit is 180 s.
1. Fixed `.mdbbcode` files still reporting MD033 for the editor's centered `<div>` / color `<span>` and MD041 for a centered H1 when a project `.markdownlint.json` (for example one with `"default": true` at the workspace root) was in use: the `.mdbbcode` format rules now apply on top of project configs too. In `.mdbbcode`, MD041 now accepts an H1 inside centered or colored editor wrappers, even nested; `.md` files keep the stock rule.
1. Fixed the drag handle and `+` sitting below the first line of task-list items in Visual: the checkbox's screen-reader-only label was taken for the item's first line.
1. Fixed hovering an icon button (block drag handle, `+`, toolbar, Folder Browser, Lint and Outline buttons) showing the system tooltip on top of the app's own: elements with an app tooltip now keep their text in `data-tooltip` instead of `title`, including titles set later by code (`src/icons.js`). Elements without an app tooltip (paths, file rows, outline items) keep their native one.
1. Fixed the block drag handle and `+` (and Hybrid's block actions) sitting off-center on headings, task lists, quotes, callouts and code blocks: they are now centered on the first line of their block in Visual and Hybrid, including the block being edited (`src/first-line.js`).
1. Fixed task-list checkboxes sitting a few pixels below their text: Visual and the Hybrid preview now center the checkbox on the first line of the item, and the live checkbox in an active Hybrid block is centered on its line too.
1. Changed centering several blocks at once (Visual toolbar and Turn Into, Hybrid multi-block `Wrap`) to give each block its own `<div style="text-align: center">` instead of one shared wrapper, so every block carries its own alignment. Nexus BBCode export now has one `[center]` pair per block, which renders the same. Existing shared wrappers are left untouched.
1. Fixed a block moved out of a Centered Block that holds several blocks losing its centering: it now leaves in a Centered Block of its own (Alt+Up/Down, Move Up/Down, drag and drop).
1. Changed markdownlint MD033 (no inline HTML) to stay off for `.mdbbcode` files on top of the app settings (a project `.markdownlint.json(c)` still applies as-is), with a note on MD033 in the rule browser, and added `div` to the app profile's allowed elements so the editor's own `<div style="text-align: center">` no longer warns in `.md` files (the color `<span>` was already allowed).
1. Fixed moving a Centered Block in Visual mode with `Alt+Up`/`Down`, `Move Up`/`Down` or drag and drop: the block lost its centering (the handle grabbed the paragraph inside the `<div style="text-align: center">` and moved it out, dissolving the wrapper), and blocks moved onto it could land inside and become centered. A Centered Block around a single block now moves as one unit and blocks land beside it.
1. Changed lint Fix and Fix All in Visual mode to keep undo history: the fixed source is re-parsed and only the changed top-level blocks are replaced in one transaction, so Ctrl+Z restores the exact original source and Ctrl+Y re-applies it; source-only fixes (spacing, blank lines, list indents) have their own undo entry. The confirm-and-reload dialog remains only as a fallback.
2. Added `Don't Show This Again` to informational prompts (Visual fix fallback, BBCode Export Notes, BBCode Import Notes) and a Settings > Prompts page to show them again or `Reset All` (`preferences.dismissedPrompts` in `session.json`).
1. Added the Properties panel, a collapsible visual editor for YAML front matter above Visual and Hybrid (`src/properties/`, a 23 KB lazy chunk loaded only for documents with front matter or when adding properties). Types (`Text`, `Number`, `Checkbox`, `Date`, `Date & Time`, `List`, nested `Object`, raw YAML fallback) are inferred from values and switchable from each row's type menu; rows can be renamed, removed with `Undo`, reordered by dragging or `Alt+Up`/`Down`, and added with `Add Property`, `/properties` or `Ctrl+;`. Untouched front matter is kept byte for byte; edits re-serialize it through the YAML Document API (comments, key order and untouched styles kept, block lists, empty values as `key:`), and only the front matter changes, so the editor body, its undo history and selection stay put. Settings > General gains `Properties Panel` (`Remember` / `Expanded` / `Collapsed`, stored as `propertiesPanel` in `session.json`). Hybrid blocks now render into `#hybrid-blocks` inside the `#hybrid-editor` scroller.
1. Changed the Lint tab's BBCode export warnings to a scope: Settings > Linting `BBCode Export Warnings` is now `All Markdown Files`, `Only .mdbbcode Files` (default) or `Off`, stored as `lint.bbcodeScope` (the old `lint.bbcode` migrates: true or missing → `.mdbbcode` only, false → `Off`). The BBCode worker never loads for documents out of scope, and the folder audit follows the same rule per file.
2. Added the Lint tab switch `BBCode Warnings For This File`, which writes `bbcodeLint: true | false` into the document's front matter (only that line changes; removed again when it matches the global default) and overrides the global scope in both directions. Undoable in Source; Visual and Hybrid keep their body and undo history.
3. Added a TODO entry to speed up BBCode conversion and lift the 100 KB lint limit.
1. Fixed documents with inline code inside bold, italic, strike, links, spoilers or color (for example `` **`Ctrl+Shift+P`** `` in TODO.md) refusing to open in Visual mode ("Invalid collection of marks for node text: bold,code"): Tiptap's Code mark excluded every other mark. Inline code now combines with them, serializes innermost so the Markdown round-trips byte-identically, and exports as `[b][code]…[/code][/b]` in Nexus and Steam BBCode.
2. Added coded errors when Visual or Hybrid cannot open a document: the Source fallback now shows an error-toned notice such as `Visual mode can't open this document (MBB-VISUAL-002: unsupported or unfinished HTML at line 5). Source view keeps it unchanged.`, with the code table in `docs/ERRORS.md` (`src/editor-errors.js`). Saving is unaffected.
1. Added BBCode export warnings to the Lint tab: a `BBCode (Nexus)` / `BBCode (Steam)` group (`BB-NEXUS-…`/`BB-STEAM-…` codes such as `BB-STEAM-H4`, export errors as errors) built from the existing converter output and mapped to the lines of the blocks that produce them, computed in a second lazy worker (conversion takes about 0.6 s at 50 KB and 2.4 s at 100 KB) up to 100 KB, with `Include BBCode Export Warnings` in Settings (`lint.bbcode`, default on). Export behaviour is unchanged.
2. Added an on-demand Folder audit to the Lint tab (`This Document | Folder`): lints the Markdown files under the Folder Browser root through the lint worker and project-config resolution, with progress, `Cancel`, a 500-file and 2 MB-per-file cap, per-file groups and click-to-open-and-jump. Main bundle grows by about 4 KB; the audit UI is a 5.5 KB lazy chunk.
1. Added lint inline markers and quick fixes (`src/lint/lint-markers.js`, a lazy chunk loaded once a result is ready; the main bundle grows by about 4 KB): Hybrid blocks with problems get amber/red left-edge gutter marks, the active Hybrid block gets wavy underlines with a hover tooltip and `Fix`, Visual marks the containing top-level block with a ProseMirror node decoration, and the floating outline rail shows proportional problem ticks. `Show Inline Markers` in Settings (`lint.markers`, default on) turns them off. Fixable problems get `Fix` buttons and the Lint toolbar `Fix All` (markdownlint `applyFixes` in the worker); Source fixes are undoable with Ctrl+Z, Hybrid fixes use the hybrid source update path, and Visual fixes ask first (`Fix Anyway`, `Switch to Source`, `Cancel`).
2. Fixed opening any dialog in Visual mode marking the document as edited and re-serializing it: Tiptap's `setEditable` emitted a content-free `update`, now suppressed.
1. Added a Settings dialog (header gear, `Ctrl+,`) loaded on first open (`src/settings/`, separate chunks; the main bundle grows by about 6 KB): `General` mirrors the BBCode dialect, `Width` and Outline controls, and `Linting` adds the master toggle, `Lint Delay` (150–2000 ms), `Large File Threshold` (50–5000 KB), presets (`Markdown BBCode Default`, `markdownlint Default`, lazy `Relaxed`) and a rule browser generated from markdownlint's config schema with search, tag-based categories, `Only Modified`, per-rule enable, `Warning`/`Error` severity, typed option editors, `Reset` and documentation links. `session.json` `lint` now stores `{ enabled, preset, rules, debounceMs, largeFileKB }` (old sessions still load). The nearest `.markdownlint.jsonc`/`.markdownlint.json` above the active document (JSONC, relative `extends`, cached per folder and rechecked on window focus) replaces the app rules read-only; YAML, rc, `.cjs` and `.mjs` configs show a notice.
1. Added opt-in Markdown linting with markdownlint 0.42.2 (`src/lint/`): the docked right pane gains `Outline | Lint` tabs (tab persisted as `rightPanelTab`, enable state as `lint.enabled` in `session.json`), the Lint tab lists problems grouped by rule with counts, line numbers, documentation links and click-to-jump across Visual, Hybrid and Source, and the footer shows a problem count that opens the Lint tab. markdownlint runs only inside a lazily created module Web Worker (separate build chunk, never loaded while linting is off), debounced 400 ms with a 2 s max wait, latest-wins, active document only, with on-demand linting for files over 300 KB. The default rule profile disables MD013, MD028 and MD041, allows `span`/`center`/`details` and similar inline HTML, limits MD024 to sibling headings and ignores YAML `title` for MD025.
1. Updated Nexus BBCode list formatting to glue `[list]` and `[list=1]` openings and their first `[*]` item directly onto preceding blocks (`...[list][*]...`, including nested lists and callout/container lists) while keeping `\n` after `[/list]` and preserving intentional extra blank lines.
2. Updated Nexus BBCode `[hr]`, `[quote]` (including callouts), and `[code]` blocks to use single newlines (`\n`) before and after them across top-level blocks and containers (while gluing directly into a following `[list]`/`[list=1]` and preserving intentional extra blank lines).
3. Added a line-level 3-way auto-sync and interactive Diff View (`src/diff.js`, `src/diff-dialog.js`): clean external disk changes and non-intersecting local/disk additions or removals auto-merge without raising a conflict while showing a reviewable `View Diff` / `Revert Sync` notice, and intersecting conflicts open a Unified / Side-by-Side diff modal with collapsible context and per-hunk `Keep Mine` / `Use Disk` / `Keep Both` resolution alongside `Load Disk Version`, `Keep My Edits`, and `Save As`.
4. Persisted the Document Outline mode (`Off` / `Float` / `Dock`, stored globally as `outlineMode` in `session.json`) across application launches and tabs.
5. Updated the header `Nexus | Steam` dialect switcher and BBCode preview pane heading to render the bundled `NexusMods.svg` and `Steam.svg` icons while retaining accessible names and hover/focus tooltips.
6. Fixed pasting valid Markdown into Visual mode (`MarkdownPaste` + `parsePastedMarkdown` in `src/markdown.js`) so formatted Markdown renders as rich blocks and inline marks instead of inserting escaped plain text (`\#`, `\*`, `\-`, etc.), while keeping code blocks, inline code, bare URLs, plain text, rich HTML, and unsafe HTML literal.
7. Fixed externally deleted open files blocking tab closing and window exit: `DocumentStore.flush` and `DocumentStore.checkExternal` surface and clear `missing` errors consistently, the notice bar exposes `Review Missing File` and `Close Tab`, `File Missing On Disk` adds `Close Tab` / `Close Without Saving`, clean missing tabs close and allow quitting directly without recreating deleted files, and dirty missing tabs focus and prompt before discarding unsaved edits.
8. Added symlink, NTFS directory junction, and hard-link support across the Folder Browser, search, file opening, and file saving (`src-tauri/src/main.rs`, `src/documents.js`, `src/main.js`, `src/folder-browser.js`): readable linked files (including extensionless symlinks to readable targets) and linked directories display natively in workspace tree paths without breaking symlinks/hard links on save and with cycle protection.
9. Suppressed default WebView2 right-click menus across non-text UI chrome (`src/context-menu.js`) and filtered `ContextMenuRequested` (`src-tauri/src/main.rs`) to strip browser clutter (`Back`, `Reload`, `Save as`, `Print`, `Share`, `Web capture`, `Read aloud`, `Emoji`, `Copilot`, `Inspect`, etc.) while preserving `Cut`, `Copy`, `Paste`, `Paste as plain text`, `Select all`, `Undo`, `Redo`, and spellcheck actions in editable areas plus `Copy` on read-only text selections alongside custom Folder Browser and Visual table-edge menus.
10. Removed the unintended Warm Amber `:focus-visible` outline lines from the Visual and Hybrid editable text surfaces (most visible flanking the centered `Page` width column while editing) while preserving keyboard focus rings on interactive UI controls.
11. Updated Folder Browser directory filtering (`ignoredDirName` in `src-tauri/src/main.rs`) so `Dist` and `Build` folders remain visible and searchable whenever they hold readable files or symlinks (while still hiding asset-only `Dist`/`Build` folders by default), and added automatic race-safe Folder Browser refreshing on window focus/activation (`window-focused` / `focus` / `visibilitychange`, deferring refreshes cleanly while collapsed or during inline file actions).
12. Added full variable-length CommonMark fenced code block support (`src/code-fence.js`, `src/markdown.js`, `src/source-formatting.js`, `src/hybrid-live-preview.js`, `src/outline.js`, `src/folder-browser-model.js`) so 4+ backtick (` ```` `), 5+ backtick (` ````` `), and tilde (`~~~~`) fences automatically wrap and preserve inner backtick runs (such as ```` ```Code inside code``` ````) across Visual mode serialization/input rules, Hybrid Live Preview, Source formatting inspection, Document Outline extraction, BBCode import/export, and `.txt` format detection.

## 0.2.12 — 2026-11-24

1. Aligned the dark theme palette and CSS tokens strictly with the workspace shared `DESIGN.md`: zero-chroma neutral ladder (`#111111` page, `#171717` surface, `#262626` control, `#404040` active/border, `#a1a1a1` accent/secondary, `#f5f5f5` text, `#737373` muted), sparing Warm Amber signature (`#b45309` primary fill / `#f4b570` signature text), shared status tokens, Surface+Border tooltips, 60% black modal backdrops, tabular numerals, and 4 px thin neutral scrollbars, while keeping matching zero-chroma Light Mode.
2. Updated the `[M↓]` app icon card background and border (`#171717` / `#404040`) and glyph strokes (`#f5f5f5`) to remove slate chroma tinting.
3. Added the formal `App Declarations` and `Color System` specifications to the project `DESIGN.md`.
4. Fixed Nexus BBCode spacing to retain blank lines (`\n\n`) between regular paragraphs and between titles/headings and paragraphs while omitting blank lines (`\n`) before and after lists (including inside callouts/containers and extra blank line alignment).
5. Added Steam guide BBCode export, live preview, `.bbcode`/`.txt` file export and Steam BBCode import (`[h1]`–`[h3]`, `[strike]`, `[olist]`, `› ` flattened nested lists, `[table]`, `[hr][/hr]`, `[noparse]`, bare YouTube/Steam store/Workshop embeds and glued `[code]`) modeled on `Steam Markdown`, controlled by a persisted header `Nexus | Steam` switcher and enabled in legacy `.mdbbcode` Target properties.
6. Hardened `scripts/package.mjs` to detect elevated or path-hidden `Markdown BBCode.exe` instances locking the portable destination folder and abort cleanly with an actionable message instead of failing mid-copy with `EPERM`.

## 0.2.11 — 2026-11-24

1. Added middle-mouse-button (`auxclick`) tab closing (canceling cleanly if dragged off before release, ignoring right-clicks, preventing middle-click auto-scroll, and preserving draft recovery and the single-tab invariant).
2. Added persistent window size, position, and maximized/fullscreen state via `tauri-plugin-window-state` (stored inside `portable-data/window-state.json` when portable or app config directory when installed) paired with an automatic startup off-screen and taskbar rescue guard.
3. Added `--graceful-close` single-instance support for `npm run portable` hot-swaps so open instances save and exit cleanly without requiring direct Win32 window-handle access.

## 0.2.10 — 2026-11-23

1. Added the Notion-style `Width [Page | Full]` segmented toggle in the document bar (defaulting to an `800px` centered reading column across Visual, Hybrid, and Source modes while persisting the preference globally).

## 0.2.9 — 2026-11-23

1. Rebranded the application from `BBCode Editor` to `Markdown BBCode` across the interface, window title, executable (`Markdown BBCode.exe`), Tauri identifier (`com.fuzen777.markdown-bbcode`), single-instance lock and repository files.
2. Created and integrated the new `[M↓]` monogram app icon across generated desktop icons, installers and the top navigation bar brand mark.
3. Extracted the full commit and tag history (`v0.1.0`–`v0.2.8`) into its own standalone GitHub repository (`Fuzen777/Markdown-BBCode`).
4. Added dual Portable (`Portable.txt` / `portable-data`) and Windows per-user NSIS Installed (`%APPDATA%\Markdown BBCode` with legacy data migration) modes alongside one-click signed GitHub auto-updates (silent startup check, footer manual version check button, header `Update vX.Y.Z` button, pre-update save flush and conflict guard, NSIS updater plugin and SHA-256 + Ed25519 minisign verified portable `.zip` swap).
5. Updated `npm run portable` to deploy directly to `D:\Apps\Markdown BBCode\Markdown BBCode.exe` (gracefully closing and relaunching an already-open instance while keeping `portable-data` intact) and added `.github/workflows/release.yml` to build and sign official GitHub Releases only on explicit `workflow_dispatch` or `release/v*` tags.

## 0.2.8 — 2026-11-23

1. Added a resizable, collapsible left-side Folder Browser (`Ctrl+Shift+E`, open by default with a close button and persisted state/width) for quick navigation across standalone files and multi-mod monorepos without mandatory setup.
2. Added zero-setup navigation and workspace filtering in the Folder Browser: auto-follows the active file, supports clickable path breadcrumbs and parent climbing, remembers Pinned and Recent folders, locks pinned/chosen roots across outside tabs with one-click `Reveal Active File`, expands nested folders lazily, searches recursively, filters for `.md`, `.markdown`, `.mdbbcode`, `.txt`, and `.bbcode` (`Import` badge), and hides empty/asset-only directories by default behind an `All` toggle.
3. Added Light Explorer file actions (inline `+ New File` defaulting `.md` with overwrite protection, inline `Rename` syncing open tabs, context-menu `Reveal In Explorer`, `Copy Path`, `Open As Root`, `Pin`/`Unpin`, and folder drag-and-drop) plus smart `.txt` format auto-detection (opening Markdown/plain `.txt` directly for in-place editing while routing BBCode-tagged `.txt` and `.bbcode` through one-time Import).
4. Updated Nexus BBCode serialization to collapse standard Markdown block separators (`\n\n`) and container/callout breaks to single newlines (`\n`) so paragraphs and headings match Nexus Mods line rendering while preserving intentional extra blank lines (`\n\n\n` -> `\n\n`) and scroll-sync offsets.

## 0.2.7 — 2026-11-23

1. Centered gutter drag handles and `+` controls vertically on horizontal rules (`---` / `<hr>`) across both Visual and Hybrid modes, keeping hover locked across the approach band.
2. Added Obsidian-style line/item-level Live Preview inside active Hybrid blocks: cursor-touched lines reveal distinct raw syntax markers while sibling lines in lists, tasks, callouts, quotes and paragraphs render headings, bullets, interactive checkboxes, callout badges and border colors, dividers and inline formatting live without altering source on disk.
3. Improved Hybrid editing ergonomics with click-to-cursor placement near the clicked word, vertical `ArrowUp`/`ArrowDown` navigation across wrapped visual lines and adjacent blocks preserving column, boundary `Backspace`/`Delete` removal of top-level blank separators, direct task checkbox toggling and link hover/`Ctrl+Click` popovers in both previews and active blocks, click-below-last-block trailing creation and smart `Enter`/`Tab`/`Shift+Tab` list and quote continuation.
4. Added Visual-mode parity and responsiveness to Hybrid: incremental sibling DOM preservation across non-splitting edits, live-filtering `/` slash menu with aliases and Image insertion on any line, `Turn Into` submenu in Block Actions, multi-block `Wrap In` and `Delete`/`Backspace` removal, and the shared floating selection bubble bar.

## 0.2.6 — 2026-11-23

1. Prioritized Windows virtual keys (`VK_A`–`VK_Z`) over layout-shifted `event.key` characters for `Ctrl` shortcuts across Visual, Hybrid, and Source modes so split `Ctrl` drivers such as `BÉPO azerty-ctrl` match `Ctrl` shortcut keys reliably (including dead-key `Ctrl+Y` Redo).
2. Guarded Visual (TipTap/ProseMirror) and Hybrid (CodeMirror) keymaps against mismatched `Ctrl` letter misfires while leaving normal BÉPO typing, `AltGr` characters, and native clipboard shortcuts untouched.
3. Added process-tree timeout guards across automated test suites (`30s` unit tests, `120s` Playwright UI suite with a `20s` webServer startup limit and `maxFailures: 5`, and `60s` native smoke) so hung test runs terminate promptly.

## 0.2.5 — 2026-11-23

1. Expanded `/` slash and Turn Into options with Divider, Toggle (collapsed callout), Spoiler Block, Centered Block and Image plus short keyword aliases (`/h1`–`/h3`, `/todo`, `/ul`, `/ol`, `/hr`, `/div`, `/img`, `/toggle`, `/warn`, `/tip`), alongside an active-line `Type '/' for commands…` Visual placeholder.
2. Added cross-mode Smart URL Paste on selected text, link hover/caret popover (Open via validated desktop command, Copy, Edit, Unlink), expanded formatting bubble bar (`Turn Into`, color swatches, `Choose Color…`, `Clear Color`), Visual code block language/copy bar, image hover pill with URL/alt dialog and cross-mode shortcuts (`Ctrl+K`, `Ctrl+Shift+X`, `Ctrl+E`, `Ctrl+Alt+0`–`6`, `Alt+Up`/`Down`).
3. Added Visual table row/column drag handles (click for menu, pointer-drag to reorder with Header Row normalization), drag-to-nest list items and Callouts/containers, Shift/Ctrl+Click plus left-gutter marquee multi-block selection across Visual and Hybrid, and a right-side segmented Document Outline (`Off` / `Float` / `Dock`).
4. Created [TODO.md](TODO.md) tracking the deferred Quick Command Palette and wiki backlinks recognition.

## 0.2.4 — 2026-11-23

1. Added draggable splitter resize (with double-click reset and keyboard support) and bidirectional block-anchored scroll sync to the Nexus BBCode preview pane.
2. Added an `8 × 8` table size grid picker, active `Header Row` button state, hover `+` row/column append rails and edge-only right-click row/column menus while preserving native cell-interior context menus.
3. Fixed Visual drag handle jump-to-previous-block and broken drag bugs by replacing HTML5 DnD with pointer-event drag-and-drop and pure vertical hit-testing in both Visual and Hybrid modes, and gave Visual lists per-item handles that follow nested indentation.
4. Added Notion-style editing ergonomics: floating selection formatting bubble bar, hover-faded gutter controls with active block tint, `Tab`/`Shift+Tab` list indenting, `Ctrl+D` duplication, inline `/` triggers inside lists/callouts and click-below-last-block paragraph creation.

## 0.2.3 — 2026-11-23

1. Fixed Visual gutter overlap over block text, added a Turn Into divider and ensured Delete Block remains visible without clipping.
2. Added outside-click dismissal to Hybrid Insert/slash menus, boundary disabled states to Hybrid Block Actions and Enter-to-submit plus link editing/removal to link dialogs.
3. Added Hybrid and Source formatting parity: live toolbar indicators, toggleable inline styles, Clear formatting support and `Ctrl+B`/`Ctrl+I` shortcuts.
4. Added a contextual Visual table toolbar, inline callout type and folding selectors, toggleable live BBCode preview pane (`Ctrl+Shift+P`), cross-mode Find & Replace (`Ctrl+F`/`Ctrl+H`), window file drag-and-drop and footer word counts.

## 0.2.2 — 2026-11-23

1. Added icon-and-text entries to Turn Into, Block Actions, Insert and slash menus, including distinct heading-level symbols and block actions (Duplicate, Move Up, Move Down, Delete).

## 0.2.1 — 2026-11-23

1. Removed phantom Hybrid rows by separating real top-level blank lines into editable blocks and moving controls into the gutter.
2. Preserved source line endings and internal container spacing across editing and blank-line actions.
3. Replaced file, formatting and block controls with locally bundled Material Symbols Rounded icons and accessible hover/focus tooltips.

4. Corrected dependency lockfile version metadata to match the installed packages.

## 0.2.0 — 2026-11-23

1. Made ordinary .md files the default, with optional YAML and source-only autosave. Existing .mdbbcode files remain supported.
2. Removed automatic BBCode companions; Copy BBCode and explicit Export BBCode convert on demand with loss warnings and replacement protection.
3. Added tables, task lists and nested Obsidian callouts with titles and folding.
4. Added Visual block menus, drag reordering and slash insertion.
5. Added Hybrid editing: edit the whole enclosing block as highlighted Markdown while other blocks stay rendered, preserving untouched source.


## 0.1.4 — 2026-11-23

1. Added one-click application of the last-used text color with a split Color button.
2. Replaced the native picker with an in-app Hex/RGB/HSL picker and visual sliders; hex accepts an optional #.
3. Persisted last-applied color and input mode across launches, independently of selection styles.
4. Preserved Visual and Source selections across color picking, with validation and cancellation protection.

## 0.1.3 — 2026-11-23

1. Fixed ineffective regeneration for .mdbbcode files without metadata: Initialize Document Properties adds Nexus settings and generates output.
2. Replaced conversion retries with Fix Source when metadata or content needs correction.
3. Preserved document text and existing-output protection during initialization; added browser and native regression coverage.

## 0.1.2 — 2026-11-23

1. Added .mdbbcode documents with YAML format, version and export target metadata.
2. Added a visual Document Properties panel with a Nexus Mods target dropdown and reserved Steam option.
3. Preserved invalid metadata while pausing export, retained unknown fields/comments and supported Save As conversion from Markdown.
4. Added active formatting indicators and selection-aware heading styles, including mixed selections and undo updates.
5. Excluded portable runtime caches from development file watching to avoid locked-file failures.

## 0.1.1 — 2026-11-22

1. Replaced SCEditor with visual Markdown editing and raw Markdown Source.
2. Added one-way companion BBCode autosave and separate output failure status.
3. Added Discord-style spoilers and HTML wrappers for centered blocks and text colors.
4. Added one-time BBCode import with loss review and original-file protection.
5. Preserved legacy recovery as explicit pending imports with a session backup.
6. Added conversion, migration and paired-save regression coverage.

## 0.1.0 — 2026-11-22

Initial portable Windows implementation using Tauri and SCEditor.

1. Added tabbed local BBCode documents and single-instance file opening.
2. Added Visual/Source switching and Copy BBCode.
3. Added Nexus formatting controls, spoiler support, and Nexus list output.
4. Added autosave, recoverable drafts, atomic file replacement, and external-change conflict handling.
5. Added source protection for unsupported or lossy visual conversions.
6. Added system light/dark appearance, file shortcuts, portable settings, and build documentation.
