# Validation

## Automated Checks

Validated on the available Windows x64 machine on 2026-11-22.

| Check | Coverage |
| --- | --- |
| JavaScript Tests | Untouched source, in-flight save edits, external conflicts, recovered drafts, failed saves, session write order, Windows path identity, and unknown tags. |
| Browser Integration | Real SCEditor visual/source conversion, supported formatting, autosave conflicts, save failures, tab isolation, light/dark layout, toolbar-generated Nexus lists, spoiler edits, and unchanged file preservation. |
| Rust Tests | Atomic replacement, external revision checks, deleted files, Unicode, Save As protection, and non-UTF-8 rejection. |
| Lint | ESLint and Rust Clippy with warnings treated as errors. |
| Native Smoke Test | Release executable running in WebView2 with real Rust file writes, clipboard copying, single-instance file dispatch, tab close, and recovery snapshot persistence. |

The browser tests replace the desktop bridge with an in-memory test backend. The native smoke test uses an isolated copy under `test-results/native` and exercises the real desktop bridge. Its debugging connection is supplied by the test process environment, not enabled by the distributed application.

## Timing Sample

| Operation | Observed Time |
| --- | --- |
| Launch To Ready With A Document | 1,153 ms |
| Second File Launch Into Existing Window | 120 ms |
| Closing A Document Tab | 31 ms |

These are single automated observations on the development machine, including automation overhead. They are not a benchmark guarantee and do not represent large-document performance.

## Remaining Manual Checks

1. Native Windows Open/Save dialog interaction: the computer-control tool failed to initialize because its sandbox launcher could not create a process security environment. Native file persistence, startup file arguments, and clipboard operations were tested separately.
2. Final rendering of a representative mod description on Nexus Mods. No content was published or submitted during testing.
3. Windows Open With association on the user's chosen permanent portable-app path. No system file association was changed during implementation.
