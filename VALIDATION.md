# Validation

## Automated Checks

Validated version 0.1.4 on Windows x64 on 2026-11-23.

| Check | Result And Coverage |
| --- | --- |
| JavaScript | 44 passed: Hex/RGB/HSL conversion, optional #, numeric validation and preference restoration, YAML parsing, invalid metadata persistence, target validation, .mdbbcode conversion, Markdown round trips, custom formatting, import warnings, migration, paired saves, conflicts, in-flight edits and output failures. |
| Browser Integration | 21 passed: color picking, one-click reuse, selection preservation, cancel/reload persistence and color dialog layout, missing-header initialization, Fix Source and initialization conflict protection, metadata/source synchronization, target dropdown, malformed YAML recovery, selection-aware toolbar state and undo, real Tiptap editing, formatting buttons, source switching, imports, recovery, autosave conflicts, save failures and responsive light/dark layouts. |
| Rust | 3 passed: atomic replacement, revision checks, missing files, Unicode, Save As protection and invalid UTF-8. |
| Lint | ESLint and Rust Clippy passed; Rust formatting applied. |
| Production Build | Frontend and portable Windows executable built successfully. Vite reports a non-blocking JavaScript chunk-size warning. |
| Native Smoke | Full app close/relaunch restoring color and input mode; missing-header initialization and real .mdbbcode writes, YAML metadata, active bold indicator, generated BBCode, clipboard copy, single-instance dispatch, tab close, recovery persistence and version-1 session backup passed with no page errors. |

Browser integration uses an in-memory desktop bridge. Native validation uses an isolated copy under test-results/native with a test-only debugging connection supplied through its environment. The distributed app does not enable that connection. Light and dark editor/picker screenshots were inspected; the picker also passed the narrow-window check.

## Timing Sample

| Operation | Observed Time |
| --- | --- |
| Launch To Ready With A Document | 1,346 ms |
| Second File Launch Into Existing Window | 97 ms |
| Closing A Document Tab | 36 ms |

Single observations on the development machine, including automation overhead; not guarantees or large-document benchmarks.

## Remaining Manual Checks

1. Native Open/Save dialog interaction: computer-control tools could not initialize due to their sandbox launcher. Real native file writes and startup arguments were tested independently.
2. Final appearance of a representative description on Nexus Mods. Nothing was published during validation.
3. Windows Open With association at the user's chosen permanent path. No system association was changed.

## Reported Document Regression

The user-specified Streamlined Logistics Nexus Page.mdbbcode was tested using an in-memory backend. Missing properties were detected, Nexus metadata was initialized, and 12,665 characters of BBCode were generated successfully. The document body matched the original exactly, and the original disk file hash was unchanged.
