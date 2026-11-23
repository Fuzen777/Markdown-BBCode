# Validation

## Automated Checks

Version 0.2.2, Windows x64, 2026-11-23.

| Check | Result And Coverage |
| --- | --- |
| JavaScript | 51 passed: source-only persistence, legacy migration, YAML, export validation/warnings, Markdown round trips, tasks/tables/callouts, segmentation, individual blank-line spans, colors and conflicts. |
| Browser Integration | 36 checks passed in the full suite: Visual blocks, slash menu, dragging, undo, Hybrid whole enclosing blocks, raw HTML safety, source fidelity, navigation, color selection, source-only autosave, export replacement/warnings, metadata, recovery and responsive layouts. |
| Rust | 3 passed: atomic writes, revision conflicts, missing files, Unicode, Save As and invalid UTF-8. |
| Lint | ESLint, Rust formatting check and Clippy passed. |
| Frontend | Production build passed; non-blocking JavaScript chunk-size warning. |

Browser tests use an in-memory desktop bridge. Turn Into, Block Actions, Insert and slash menus (including Duplicate, Move Up, Move Down and Delete) were visually inspected in light and dark modes. Light/dark Hybrid screenshots were inspected, including icons, focus tooltips and compact blank rows. Blank-line edit/duplicate/delete/undo and narrow layouts passed. Native smoke uses an isolated copy and a test-only WebView2 debugging connection supplied through its environment; the distributed app does not enable it.

## Native Validation

Portable Windows build and native smoke passed with no page errors: real Rust autosave, no automatic companion, Hybrid editing, clipboard, single-instance file dispatch, tab close, recovery, legacy session backup and color preferences across a full restart. Native Hybrid screenshot inspected; bundled SVG icons rendered and the two-line source produced exactly two editable lines.

| Operation | Observed Time |
| --- | --- |
| Startup With Document | 1,085 ms |
| Second File Launch Into Existing Window | 70 ms |
| Tab Close | 30 ms |

Single samples on the development machine including automation overhead; not performance guarantees.

## Remaining Manual Checks

1. Native Open/Save dialog interaction. Automated tests cover the dialog result handling and actual native file writes separately.
2. Final rendering of a representative exported description on Nexus Mods; nothing was published.
3. Windows Open With association at the chosen permanent executable path; no association was changed.
4. Large-document performance beyond the small native timing sample.
