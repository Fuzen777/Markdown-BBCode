# Validation

## Automated Checks

Version 0.2.12, Windows x64, 2026-11-24.

| Check | Result And Coverage |
| --- | --- |
| JavaScript | 85 passed: `classifyTargetProcesses`, `closeRunningProcessesGracefully` and `isFileLockedForWrite` elevated-lock hot-swap detection, `normalizeBBCodeTarget` and global `DocumentStore.bbcodeTarget` persistence, Nexus BBCode paragraph/heading blank-line spacing (`\n\n`) vs tight list spacing (`\n`) with extra intentional blank-line preservation and `blockOffsets`/`totalLines`, Steam guide BBCode conversion (`[h1]`–`[h3]`, `[strike]`, `[olist]`, `› ` flattened lists, `[table]`, `[hr][/hr]`, `[noparse]`, YouTube/Steam store/Workshop bare embeds, glued `[code]`, callouts, tasks, spoilers and conversion warnings), Steam BBCode import (`[h1]`–`[h3]`, `[strike]`, `[olist]`, `› ` flattened lists, `[table]`, `[hr][/hr]`, `[noparse]`, inline `[code]`), `detectTextFormat` Steam tag coverage, `normalizeViewportWidth` and global `DocumentStore` `viewportWidth` persistence, `runPackage` live hot-swap staging, `generateManifests`, Folder Browser helpers, Hybrid Live Preview helpers, process-tree timeout watchdog, Windows `VK_A`–`VK_Z` shortcuts, source-only persistence, legacy migration, YAML, export validation/warnings, sized GFM tables, Markdown round trips, tasks/tables/callouts, segmentation, colors, conflicts, source formatting and search matching. |
| Browser Integration | 69 passed in the full Playwright suite: header `Nexus | Steam` dialect switcher (live Nexus/Steam preview switching, `.txt` Steam export without metadata injection, `bbcodeTarget` session persistence across reload, and narrow `720x480` fit), legacy `.mdbbcode` `target: steam` and `target: nexus` switching/export, zero-chroma dark/light theme tokens (visually inspected `test-results/theme-dark-design.png` and `test-results/theme-light-design.png`), middle-mouse-button (`auxclick`) tab closing, `Width [Page | Full]` segmented toggle across Visual, Hybrid and Source, header/footer auto-updater UI, left Folder Browser flows, responsive light/dark/narrow (`720x480`) layouts, plus all Visual/Hybrid/Source/Table/Outline/BÉPO checks. |
| Rust | 11 passed, alongside clean `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`. |
| Lint | ESLint passed (`0` errors, `0` warnings). |
| Frontend & Portable Package | Production Vite build (`npm run build`, non-blocking chunk-size warning) and `npx tauri build --no-bundle` passed; `node scripts/package.mjs` detected an open elevated `Markdown BBCode.exe` lock cleanly in pre-flight and, once closed, deployed `D:\Apps\Markdown BBCode\Markdown BBCode.exe` (`14,084,608` bytes) with `portable-data` intact. |

Browser tests use an in-memory desktop bridge. Native smoke uses an isolated copy and a test-only WebView2 debugging connection supplied through its environment; the distributed app does not enable it.

## Native Validation

Portable Windows build and native smoke passed on `0.2.12` with zero page errors (`pageErrors: []`): real Rust autosave, `window-state.json` persistence verified inside `test-results/native/portable-data/window-state.json` (`1680x1200` at `(76, 76)`), no automatic companion, real `list_directory` exclusion of `portable-data` alongside live Folder Browser breadcrumbs/file highlights, Hybrid Live Preview editing, clipboard, single-instance file dispatch, tab close, recovery, legacy session backup and color preferences across a full restart. Native screenshot (`test-results/native-window.png`) was visually inspected via `read_file`; `[M↓]` branding, `Nexus | Steam` header switch, `Width [Page | Full]`, `Outline`, `v0.2.12` footer check button, bundled icons and the left Folder Browser rendered cleanly with zero overlap.

| Operation | Observed Time |
| --- | --- |
| Startup With Document | 1703 ms |
| Second File Launch Into Existing Window | 140 ms |
| Tab Close | 68 ms |

Single samples on the development machine including automation overhead; not performance guarantees.

## Remaining Manual Checks

1. Interactive feel check of middle-click tab close, multi-launch window size/position recall and off-screen rescue, `[M↓]` branding, `Width [Page | Full]`, left Folder Browser, Hybrid Live Preview and live Windows shortcuts under `BÉPO azerty-ctrl`.
2. Signed per-user NSIS installer test when desired from [v0.2.10 Releases](https://github.com/Fuzen777/Markdown-BBCode/releases/tag/v0.2.10) (live portable self-update from `0.2.9` to `v0.2.10` already confirmed working).
3. Native Open/Save/Folder picker dialog interaction. Automated tests cover the dialog result handling and native filesystem operations separately.
4. Final rendering of exported descriptions on Nexus Mods and Steam guides; nothing was published.
5. Windows Open With association at `D:\Apps\Markdown BBCode\Markdown BBCode.exe`; no association was changed.
6. Large-document and large-monorepo performance beyond the automated budget limits and small native timing sample.
