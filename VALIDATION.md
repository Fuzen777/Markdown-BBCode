# Validation

## Automated Checks

Version 0.2.11, Windows x64, 2026-11-24.

| Check | Result And Coverage |
| --- | --- |
| JavaScript | 77 passed: `normalizeViewportWidth` and global `DocumentStore` `viewportWidth` persistence, `runPackage` live hot-swap staging, `generateManifests`, Folder Browser helpers, smart `.txt` format detection, Nexus BBCode single-newline spacing preserving extra blank lines, Hybrid Live Preview helpers, process-tree timeout watchdog, Windows `VK_A`–`VK_Z` shortcuts, source-only persistence, legacy migration, YAML, export validation/warnings, sized GFM tables, Markdown round trips, tasks/tables/callouts, segmentation, colors, conflicts, source formatting and search matching. |
| Browser Integration | 67 passed in the full Playwright suite: middle-mouse-button (`auxclick`) tab closing (closing inactive and active tabs, drag-away cancel, ignoring right clicks, draft preservation and last-tab invariance), `Width [Page | Full]` segmented toggle across Visual, Hybrid and Source, header/footer auto-updater UI, left Folder Browser flows, responsive light/dark/narrow (`720x480`) layouts, plus all Visual/Hybrid/Source/Table/Outline/BÉPO checks. |
| Rust | 11 passed: `resolves_offscreen_and_taskbar_window_rescue` (primary monitor, negative-coordinate secondary monitor, Aero-snapped overhang tolerance, disconnected monitor centering, top/bottom taskbar clamping and oversized laptop shrinking), `detects_graceful_close_flag_and_ignores_it_as_path`, `compares_semver_and_detects_portable_mode`, `verifies_signed_portable_payloads_and_extracts_zip_safely`, `listDirectoryImpl` filters and `Show All`, `searchDirectoryImpl` skipping `.git`, `createFileImpl`, `renamePathImpl`, plus atomic writes, revision conflicts, missing files, Unicode, Save As, invalid UTF-8 and external URL scheme validation. |
| Lint | ESLint, `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` passed. |
| Frontend & Portable Package | Production Vite build passed (non-blocking chunk-size warning); `npx tauri build --no-bundle` built `markdown-bbcode.exe` and `node scripts/package.mjs` deployed `D:\Apps\Markdown BBCode\Markdown BBCode.exe` (`14,081,024` bytes) while keeping `portable-data` intact. |

Browser tests use an in-memory desktop bridge. Native smoke uses an isolated copy and a test-only WebView2 debugging connection supplied through its environment; the distributed app does not enable it.

## Native Validation

Portable Windows build and native smoke passed on `0.2.11` with zero page errors (`pageErrors: []`): real Rust autosave, `window-state.json` persistence verified inside `test-results/native/portable-data/window-state.json` (`1680x1200` at `(76, 76)`), no automatic companion, real `list_directory` exclusion of `portable-data` alongside live Folder Browser breadcrumbs/file highlights, Hybrid Live Preview editing, clipboard, single-instance file dispatch, tab close, recovery, legacy session backup and color preferences across a full restart. Native screenshot (`test-results/native-window.png`) was visually inspected via `read_file`; `[M↓]` branding, `Width [Page | Full]`, `Outline`, `v0.2.11` footer check button, bundled icons and the left Folder Browser rendered cleanly with zero overlap.

| Operation | Observed Time |
| --- | --- |
| Startup With Document | 1520 ms |
| Second File Launch Into Existing Window | 232 ms |
| Tab Close | 85 ms |

Single samples on the development machine including automation overhead; not performance guarantees.

## Remaining Manual Checks

1. Interactive feel check of middle-click tab close, multi-launch window size/position recall and off-screen rescue, `[M↓]` branding, `Width [Page | Full]`, left Folder Browser, Hybrid Live Preview and live Windows shortcuts under `BÉPO azerty-ctrl`.
2. Signed per-user NSIS installer test when desired from [v0.2.10 Releases](https://github.com/Fuzen777/Markdown-BBCode/releases/tag/v0.2.10) (live portable self-update from `0.2.9` to `v0.2.10` already confirmed working).
3. Native Open/Save/Folder picker dialog interaction. Automated tests cover the dialog result handling and native filesystem operations separately.
4. Final rendering of a representative single-newline exported description on Nexus Mods; nothing was published.
5. Windows Open With association at `D:\Apps\Markdown BBCode\Markdown BBCode.exe`; no association was changed.
6. Large-document and large-monorepo performance beyond the automated budget limits and small native timing sample.
