# Changelog

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
