# Validation

## Automated Checks

Version 0.2.4, Windows x64, 2026-11-23.

| Check | Result And Coverage |
| --- | --- |
| JavaScript | 57 passed: source-only persistence, legacy migration, YAML, export validation/warnings, BBCode block-offset mapping, sized GFM table generation, Markdown round trips, tasks/tables/callouts, segmentation, individual blank-line spans, colors, conflicts, source formatting toggling/clear, active formatting inspection and search matching. |
| Browser Integration | 49 checks passed in the full suite: Visual blocks, gutter non-overlap, Turn Into divider, slash menu, pointer-event dragging in Visual and Hybrid, horizontal gutter approach lock, per-list-item handles following nesting, Tab/Shift+Tab list indenting, inline slash triggers inside lists, click-below-trailing-block insertion, floating selection bubble menu, Ctrl+D duplication, undo, Hybrid whole enclosing blocks, menu outside-click dismissal, boundary disabled states, Hybrid/Source formatting parity and shortcuts, link editing/Enter submit, table size grid picker, active Header Row state, hover + row/column rails, edge-only right-click table menus, contextual table controls, inline callout type/fold selectors, live BBCode preview pane with draggable splitter resize and bidirectional scroll sync, cross-mode Find & Replace, raw HTML safety, source fidelity, navigation, color selection, source-only autosave, export replacement/warnings, metadata, recovery, word counts, dropped files and responsive layouts. |
| Rust | 3 passed: atomic writes, revision conflicts, missing files, Unicode, Save As and invalid UTF-8. |
| Lint | ESLint, Rust formatting check and Clippy passed. |
| Frontend | Production build passed; non-blocking JavaScript chunk-size warning. |

Browser tests use an in-memory desktop bridge. Light, dark and narrow 0.2.4 screenshots (floating bubble menu, nested list and task handles with inline checkboxes, pointer drag ghost, 8 × 8 table grid popover, hover + column rail, edge-only right-click table menu, resized preview split and narrow stacked preview) were visually inspected alongside Visual gutter alignment, Turn Into divider, table toolbar, inline callout controls, Find & Replace highlights, Hybrid Block Actions boundary state and native Hybrid and Visual screenshots. Light/dark Hybrid screenshots were inspected, including icons, focus tooltips and compact blank rows. Blank-line edit/duplicate/delete/undo and narrow layouts passed. Native smoke uses an isolated copy and a test-only WebView2 debugging connection supplied through its environment; the distributed app does not enable it.

## Native Validation

Portable Windows build and native smoke passed with no page errors: real Rust autosave, no automatic companion, Hybrid editing, clipboard, single-instance file dispatch, tab close, recovery, legacy session backup and color preferences across a full restart. Native Hybrid and Visual screenshots inspected; bundled SVG icons rendered, Visual gutter controls cleared text without overlap and the two-line source produced exactly two editable lines.

| Operation | Observed Time |
| --- | --- |
| Startup With Document | 901 ms |
| Second File Launch Into Existing Window | 64 ms |
| Tab Close | 22 ms |

Single samples on the development machine including automation overhead; not performance guarantees.

## Remaining Manual Checks

1. Native Open/Save dialog interaction. Automated tests cover the dialog result handling and actual native file writes separately.
2. Final rendering of a representative exported description on Nexus Mods; nothing was published.
3. Windows Open With association at the chosen permanent executable path; no association was changed.
4. Large-document performance beyond the small native timing sample.
