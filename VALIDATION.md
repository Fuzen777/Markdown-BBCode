# Validation

## Automated Checks

Version 0.2.3, Windows x64, 2026-11-23.

| Check | Result And Coverage |
| --- | --- |
| JavaScript | 56 passed: source-only persistence, legacy migration, YAML, export validation/warnings, Markdown round trips, tasks/tables/callouts, segmentation, individual blank-line spans, colors, conflicts, source formatting toggling/clear, active formatting inspection and search matching. |
| Browser Integration | 43 checks passed in the full suite: Visual blocks, gutter non-overlap, Turn Into divider, slash menu, dragging, undo, Hybrid whole enclosing blocks, menu outside-click dismissal, boundary disabled states, Hybrid/Source formatting parity and shortcuts, link editing/Enter submit, contextual table controls, inline callout type/fold selectors, live BBCode preview pane, cross-mode Find & Replace, raw HTML safety, source fidelity, navigation, color selection, source-only autosave, export replacement/warnings, metadata, recovery, word counts, dropped files and responsive layouts. |
| Rust | 3 passed: atomic writes, revision conflicts, missing files, Unicode, Save As and invalid UTF-8. |
| Lint | ESLint, Rust formatting check and Clippy passed. |
| Frontend | Production build passed; non-blocking JavaScript chunk-size warning. |

Browser tests use an in-memory desktop bridge. Visual gutter alignment, Turn Into divider, table toolbar, inline callout controls, live BBCode preview (light, dark and narrow), Find & Replace highlights and Hybrid Block Actions boundary state were visually inspected alongside native Hybrid and Visual screenshots. Light/dark Hybrid screenshots were inspected, including icons, focus tooltips and compact blank rows. Blank-line edit/duplicate/delete/undo and narrow layouts passed. Native smoke uses an isolated copy and a test-only WebView2 debugging connection supplied through its environment; the distributed app does not enable it.

## Native Validation

Portable Windows build and native smoke passed with no page errors: real Rust autosave, no automatic companion, Hybrid editing, clipboard, single-instance file dispatch, tab close, recovery, legacy session backup and color preferences across a full restart. Native Hybrid and Visual screenshots inspected; bundled SVG icons rendered, Visual gutter controls cleared text without overlap and the two-line source produced exactly two editable lines.

| Operation | Observed Time |
| --- | --- |
| Startup With Document | 972 ms |
| Second File Launch Into Existing Window | 59 ms |
| Tab Close | 26 ms |

Single samples on the development machine including automation overhead; not performance guarantees.

## Remaining Manual Checks

1. Native Open/Save dialog interaction. Automated tests cover the dialog result handling and actual native file writes separately.
2. Final rendering of a representative exported description on Nexus Mods; nothing was published.
3. Windows Open With association at the chosen permanent executable path; no association was changed.
4. Large-document performance beyond the small native timing sample.
