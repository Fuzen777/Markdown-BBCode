# Validation

## Automated Checks

Version 0.2.6, Windows x64, 2026-11-23.

| Check | Result And Coverage |
| --- | --- |
| JavaScript | 64 passed: process-tree timeout watchdog exit/hang enforcement, Windows `VK_A`–`VK_Z` virtual-key shortcut resolution and mismatch detection, source-only persistence, legacy migration, YAML, export validation/warnings, BBCode block-offset mapping, sized GFM table generation, Markdown round trips (including fenced code language, dividers and image alt text), tasks/tables/callouts, segmentation, individual blank-line spans, colors, conflicts, source formatting toggling/inline code/link stripping, line movement, HTTP URL detection, active formatting inspection and search matching. |
| Browser Integration | 58 checks passed in the full suite: Windows virtual-key shortcuts across Visual, Hybrid and Source (simulating split `Ctrl` layouts such as `BÉPO azerty-ctrl`, including dead-key `Ctrl+Y` Redo and mismatched native clipboard safety), Visual blocks, gutter non-overlap, Turn Into actions and aliases, slash menu with viewport flip and Divider/Toggle/Spoiler/Center/Image commands, active-line placeholder, cross-mode shortcuts and Smart URL Paste, floating selection bubble menu with Turn Into and color controls, link/code block/image inline overlays and image dialog, pointer-event dragging and drag-to-nest list/callout drops in Visual and Hybrid, Shift/Ctrl/marquee multi-block selection and batch bars, horizontal gutter approach lock, per-list-item handles following nesting, Tab/Shift+Tab list indenting, inline slash triggers inside lists, click-below-trailing-block insertion, Ctrl+D duplication, undo, Hybrid whole enclosing blocks, menu outside-click dismissal, boundary disabled states, Hybrid/Source formatting parity, table size grid picker, active Header Row state, hover row/column drag-and-menu handles, + rails, edge-only right-click table menus, inline callout type/fold selectors, right-side Off/Float/Dock Document Outline, live BBCode preview pane with splitter resize and scroll sync, cross-mode Find & Replace, raw HTML safety, source fidelity, navigation, color selection, source-only autosave, export replacement/warnings, metadata, recovery, word counts, dropped files and responsive layouts. |
| Rust | 4 passed: atomic writes, revision conflicts, missing files, Unicode, Save As, invalid UTF-8 and external URL scheme validation. |
| Lint | ESLint, Rust formatting check and Clippy passed. |
| Frontend | Production build passed; non-blocking JavaScript chunk-size warning. |

Browser tests use an in-memory desktop bridge. Native Hybrid and Visual screenshots were inspected for 0.2.6 alongside native smoke checks. Previous 0.2.4 and twelve light, dark and narrow 0.2.5 screenshots, blank-line edit/duplicate/delete/undo checks and narrow layouts were also verified. Native smoke uses an isolated copy and a test-only WebView2 debugging connection supplied through its environment; the distributed app does not enable it.

## Native Validation

Portable Windows build and native smoke passed with no page errors: real Rust autosave, no automatic companion, Hybrid editing, clipboard, single-instance file dispatch, tab close, recovery, legacy session backup and color preferences across a full restart. Native Hybrid and Visual screenshots inspected; bundled SVG icons rendered, Visual and Hybrid gutter controls cleared text without overlap and the three-state outline toggle aligned cleanly beside mode controls.

| Operation | Observed Time |
| --- | --- |
| Startup With Document | 864 ms |
| Second File Launch Into Existing Window | 59 ms |
| Tab Close | 23 ms |

Single samples on the development machine including automation overhead; not performance guarantees.

## Remaining Manual Checks

1. Live Windows shortcut check under `BÉPO azerty-ctrl` with the 0.2.6 portable executable.
2. Native Open/Save dialog interaction. Automated tests cover the dialog result handling and actual native file writes separately.
3. Final rendering of a representative exported description on Nexus Mods; nothing was published.
4. Windows Open With association at the chosen permanent executable path; no association was changed.
5. Large-document performance beyond the small native timing sample.
