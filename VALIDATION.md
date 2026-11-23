# Validation

## Automated Checks

Version 0.2.10, Windows x64, 2026-11-23.

| Check | Result And Coverage |
| --- | --- |
| JavaScript | 77 passed: `normalizeViewportWidth` and global `DocumentStore` `viewportWidth` persistence (`'page'` default, `'full'` toggle, invalid-value fallback without altering `preferences`), `runPackage` live hot-swap staging, `generateManifests`, Folder Browser helpers, smart `.txt` format detection, Nexus BBCode single-newline spacing preserving extra blank lines, Hybrid Live Preview helpers, process-tree timeout watchdog, Windows `VK_A`–`VK_Z` shortcuts, source-only persistence, legacy migration, YAML, export validation/warnings, sized GFM tables, Markdown round trips, tasks/tables/callouts, segmentation, colors, conflicts, source formatting and search matching. |
| Browser Integration | 66 passed in the full Playwright suite: `Width [Page | Full]` segmented toggle across Visual, Hybrid and Source (`800px` centered column default vs full viewport width, gutter controls alignment in `Page` mode and reload persistence; `test-results/viewport-page.png` and `test-results/viewport-full.png` inspected via `read_file`), header/footer auto-updater UI, left Folder Browser flows, responsive light/dark/narrow (`720x480`) layouts, plus all Visual/Hybrid/Source/Table/Outline/BÉPO checks. |
| Rust | 9 passed: `compares_semver_and_detects_portable_mode`, `verifies_signed_portable_payloads_and_extracts_zip_safely`, `listDirectoryImpl` filters and `Show All`, `searchDirectoryImpl` skipping `.git`, `createFileImpl`, `renamePathImpl`, plus atomic writes, revision conflicts, missing files, Unicode, Save As, invalid UTF-8 and external URL scheme validation. |
| Lint | ESLint, `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` passed. |
| Frontend & Windows Binary | Production Vite build passed (non-blocking chunk-size warning); `npx tauri build --no-bundle` compiled `src-tauri/target/release/markdown-bbcode.exe` (`13,915,136` bytes). `D:\Apps\Markdown BBCode\Markdown BBCode.exe` was intentionally left at `0.2.9` (`13,915,136` bytes) for live auto-update testing. |

Browser tests use an in-memory desktop bridge. Native smoke uses an isolated copy and a test-only WebView2 debugging connection supplied through its environment; the distributed app does not enable it.

## Native Validation

The isolated `0.2.10` native smoke run was skipped per user confirmation because the user's `0.2.9` portable desktop instance (`D:\Apps\Markdown BBCode\Markdown BBCode.exe`) was actively running with single-instance lock active and no Rust backend code changed between `0.2.9` and `0.2.10`. Latest native smoke execution passed on `0.2.9` (`pageErrors: []`; native Hybrid and Visual screenshots visually inspected via `read_file`):

| Operation | Observed Time (v0.2.9) |
| --- | --- |
| Startup With Document | 1262 ms |
| Second File Launch Into Existing Window | 101 ms |
| Tab Close | 41 ms |

Single samples on the development machine including automation overhead; not performance guarantees.

## Remaining Manual Checks

1. Live end-to-end auto-update from `D:\Apps\Markdown BBCode\Markdown BBCode.exe` (`0.2.9`) to the published `v0.2.10` GitHub Release (plus signed per-user NSIS installer check).
2. Interactive feel check of `[M↓]` branding, `Width [Page | Full]`, left Folder Browser, Hybrid Live Preview and live Windows shortcuts under `BÉPO azerty-ctrl`.
3. Native Open/Save/Folder picker dialog interaction. Automated tests cover the dialog result handling and native filesystem operations separately.
4. Final rendering of a representative single-newline exported description on Nexus Mods; nothing was published.
5. Windows Open With association at `D:\Apps\Markdown BBCode\Markdown BBCode.exe`; no association was changed.
6. Large-document and large-monorepo performance beyond the automated budget limits and small native timing sample.
