# Validation

## Automated Checks

Validated version 0.1.1 on Windows x64 on 2026-11-22.

| Check | Result And Coverage |
| --- | --- |
| JavaScript | 29 passed: Markdown round trips, custom formatting, import warnings, migration, paired saves, conflicts, in-flight edits and output failures. |
| Browser Integration | 9 passed: real Tiptap editing, formatting buttons, source switching, imports, recovery, autosave conflicts, save failures and responsive light/dark layouts. |
| Rust | 3 passed: atomic replacement, revision checks, missing files, Unicode, Save As protection and invalid UTF-8. |
| Lint | ESLint and Rust Clippy passed; Rust formatting applied. |
| Production Build | Frontend and portable Windows executable built successfully. Vite reports a non-blocking JavaScript chunk-size warning. |
| Native Smoke | Real Rust source writes, generated BBCode, clipboard copy, single-instance dispatch, tab close, recovery persistence and version-1 session backup passed with no page errors. |

Browser integration uses an in-memory desktop bridge. Native validation uses an isolated copy under test-results/native with a test-only debugging connection supplied through its environment. The distributed app does not enable that connection. Light, dark and native screenshots were inspected.

## Timing Sample

| Operation | Observed Time |
| --- | --- |
| Launch To Ready With A Document | 1,051 ms |
| Second File Launch Into Existing Window | 91 ms |
| Closing A Document Tab | 44 ms |

Single observations on the development machine, including automation overhead; not guarantees or large-document benchmarks.

## Remaining Manual Checks

1. Native Open/Save dialog interaction: computer-control tools could not initialize due to their sandbox launcher. Real native file writes and startup arguments were tested independently.
2. Final appearance of a representative description on Nexus Mods. Nothing was published during validation.
3. Windows Open With association at the user's chosen permanent path. No system association was changed.
