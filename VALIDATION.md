# Validation

## Automated Checks

Version 0.2.7, Windows x64, 2026-11-23.

| Check | Result And Coverage |
| --- | --- |
| JavaScript | 69 passed: Obsidian-style Hybrid Live Preview offset mapping, task checkbox toggling, smart list/quote Enter continuation, list indentation, block-type conversion and color stripping, process-tree timeout watchdog exit/hang enforcement, Windows `VK_A`–`VK_Z` virtual-key shortcut resolution and mismatch detection, source-only persistence, legacy migration, YAML, export validation/warnings, BBCode block-offset mapping, sized GFM table generation, Markdown round trips (including fenced code language, dividers and image alt text), tasks/tables/callouts, segmentation, individual blank-line spans, colors, conflicts, source formatting toggling/inline code/link stripping, line movement, HTTP URL detection, active formatting inspection and search matching. |
| Browser Integration | 61 checks passed in the full suite: vertically centered horizontal-rule (`---`) drag handles and `+` controls with approach hover locking in both Visual and Hybrid, Hybrid Obsidian-style line/item Live Preview (cursor-line raw markers vs rendered sibling bullets, checkboxes, callout badges/borders, dividers and inline styles), click-to-cursor placement, cross-block and wrapped vertical navigation, boundary blank-line Backspace/Delete, direct preview/Live Preview task toggling, link hover/`Ctrl+Click` popovers, smart list/callout Enter continuation and `Tab`/`Shift+Tab` indenting, live-filtering slash menu with aliases and Image, `Turn Into` submenu, multi-block `Wrap In` and `Delete` removal, shared Hybrid/Visual floating selection bubble bar, incremental sibling DOM preservation, Windows virtual-key shortcuts across Visual, Hybrid and Source (simulating split `Ctrl` layouts such as `BÉPO azerty-ctrl`, including dead-key `Ctrl+Y` Redo and mismatched native clipboard safety), Visual blocks, gutter non-overlap, Turn Into actions and aliases, slash menu with viewport flip, active-line placeholder, Smart URL Paste, code block language/copy bar, image pill/dialog, pointer-event dragging and drag-to-nest list/callout drops, Shift/Ctrl/marquee multi-block selection, per-list-item handles following nesting, click-below-trailing-block insertion, Ctrl+D duplication, undo, menu outside-click dismissal, boundary disabled states, table size grid picker, active Header Row state, hover row/column drag-and-menu handles, `+` rails, edge-only right-click table menus, inline callout type/fold selectors, right-side Off/Float/Dock Document Outline, live BBCode preview pane with splitter resize and scroll sync, cross-mode Find & Replace, raw HTML safety, source fidelity, source-only autosave, export replacement/warnings, metadata, recovery, word counts, dropped files and responsive layouts. |
| Rust | 4 passed: atomic writes, revision conflicts, missing files, Unicode, Save As, invalid UTF-8 and external URL scheme validation. |
| Lint | ESLint, Rust formatting check and Clippy passed. |
| Frontend | Production build passed; non-blocking JavaScript chunk-size warning. |

Browser tests use an in-memory desktop bridge. Visual, Hybrid divider handle centering, light/dark Obsidian Live Preview, filtered slash menu, floating bubble bar plus multi-block Wrap In bar, narrow (`720x480`) responsive screenshots, and native 0.2.7 Hybrid/Visual screenshots were inspected via `read_file` with clean alignment, contrast and zero clipping. Native smoke uses an isolated copy and a test-only WebView2 debugging connection supplied through its environment; the distributed app does not enable it.

## Native Validation

Portable Windows build and native smoke passed with zero page errors (`pageErrors: []`): real Rust autosave, no automatic companion, Hybrid Live Preview editing, clipboard, single-instance file dispatch, tab close, recovery, legacy session backup and color preferences across a full restart. Bundled SVG icons rendered cleanly and gutter controls cleared text without overlap.

| Operation | Observed Time |
| --- | --- |
| Startup With Document | 929 ms |
| Second File Launch Into Existing Window | 58 ms |
| Tab Close | 23 ms |

Single samples on the development machine including automation overhead; not performance guarantees.

## Remaining Manual Checks

1. Interactive feel check of Hybrid Live Preview, divider handle alignment, and live Windows shortcuts under `BÉPO azerty-ctrl` with the 0.2.7 portable executable.
2. Native Open/Save dialog interaction. Automated tests cover the dialog result handling and actual native file writes separately.
3. Final rendering of a representative exported description on Nexus Mods; nothing was published.
4. Windows Open With association at the chosen permanent executable path; no association was changed.
5. Large-document performance beyond the small native timing sample.
