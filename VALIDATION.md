# Validation

## Automated Checks

Version 0.2.9, Windows x64, 2026-11-23.

| Check | Result And Coverage |
| --- | --- |
| JavaScript | 76 passed: `runPackage` live hot-swap staging (`portable-data` preservation, legacy `BBCode Editor.exe` cleanup, `--zip` bundling), `generateManifests` (`latest.json` and `portable-latest.json` SHA-256 and encoded release tag URLs), Folder Browser path normalization, breadcrumbs, containment, filename validation, pinned/recent persistence, `renameDocumentPath`, smart `.txt` format detection (BBCode vs Markdown vs plain text), Nexus BBCode single-newline block spacing preserving extra intentional blank lines (`\n\n\n` -> `\n\n`) and scroll-sync offsets, Obsidian-style Hybrid Live Preview helpers, process-tree timeout watchdog, Windows `VK_A`–`VK_Z` shortcuts, source-only persistence, legacy migration, YAML, export validation/warnings, sized GFM tables, Markdown round trips, tasks/tables/callouts, segmentation, colors, conflicts, source formatting and search matching. |
| Browser Integration | 65 checks passed in the full Playwright suite: header/footer auto-updater UI (`v0.2.9` manual check, `Update v0.3.0` reveal, unresolved conflict blocking and pre-update save flush), left Folder Browser flows, responsive light/dark/narrow (`720x480`) layouts, plus all Visual/Hybrid/Source/Table/Outline/BÉPO checks. |
| Rust | 9 passed: `compares_semver_and_detects_portable_mode`, `verifies_signed_portable_payloads_and_extracts_zip_safely` (SHA-256 + Ed25519 minisign + Zip Slip path traversal refusal + `portable-data` skip), `listDirectoryImpl` extension and hidden-folder filtering plus `Show All`, `searchDirectoryImpl` recursive matching skipping `.git`, `createFileImpl` creation and overwrite refusal, `renamePathImpl` rename and collision refusal, plus atomic writes, revision conflicts, missing files, Unicode, Save As, invalid UTF-8 and external URL scheme validation. |
| Lint | ESLint, `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` passed. |
| Frontend & Portable Package | Production Vite build passed (non-blocking chunk-size warning); `npx tauri build --no-bundle` built `markdown-bbcode.exe` and `node scripts/package.mjs` deployed `D:\Apps\Markdown BBCode\Markdown BBCode.exe` (`13,915,136` bytes) alongside `Portable.txt`, `README.md` and `licenses/`. |

Browser tests use an in-memory desktop bridge. Native smoke uses an isolated copy and a test-only WebView2 debugging connection supplied through its environment; the distributed app does not enable it.

## Native Validation

Portable Windows build and native smoke passed on `0.2.9` with zero page errors (`pageErrors: []`): real Rust autosave, no automatic companion, real `list_directory` exclusion of `portable-data` alongside live Folder Browser breadcrumbs/file highlights, Hybrid Live Preview editing, clipboard, single-instance file dispatch, tab close, recovery, legacy session backup and color preferences across a full restart. Native Hybrid (`test-results/native-hybrid.png`) and Visual (`test-results/native-window.png`) screenshots were inspected via `read_file`; `[M↓]` branding, `Markdown BBCode` header, `v0.2.9` footer check button, bundled icons and the left Folder Browser rendered cleanly with zero overlap.

| Operation | Observed Time |
| --- | --- |
| Startup With Document | 1262 ms |
| Second File Launch Into Existing Window | 101 ms |
| Tab Close | 41 ms |

Single samples on the development machine including automation overhead; not performance guarantees.

## Remaining Manual Checks

1. Live end-to-end GitHub Release workflow (`workflow_dispatch` / `release/v*` tag), per-user NSIS installation and one-click updater test against a published GitHub release.
2. Interactive feel check of `[M↓]` branding, left Folder Browser, Hybrid Live Preview and live Windows shortcuts under `BÉPO azerty-ctrl` with `D:\Apps\Markdown BBCode\Markdown BBCode.exe`.
3. Native Open/Save/Folder picker dialog interaction. Automated tests cover the dialog result handling and native filesystem operations separately.
4. Final rendering of a representative single-newline exported description on Nexus Mods; nothing was published.
5. Windows Open With association at `D:\Apps\Markdown BBCode\Markdown BBCode.exe`; no association was changed.
6. Large-document and large-monorepo performance beyond the automated budget limits and small native timing sample.
