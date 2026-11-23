# Validation

## Automated Checks

Version 0.2.8, Windows x64, 2026-11-23.

| Check | Result And Coverage |
| --- | --- |
| JavaScript | 74 passed: Folder Browser path normalization, breadcrumbs, containment, filename validation, pinned/recent persistence, `renameDocumentPath`, smart `.txt` format detection (BBCode vs Markdown vs plain text), Nexus BBCode single-newline block spacing preserving extra intentional blank lines (`\n\n\n` -> `\n\n`) and scroll-sync offsets, Obsidian-style Hybrid Live Preview helpers, process-tree timeout watchdog, Windows `VK_A`–`VK_Z` shortcuts, source-only persistence, legacy migration, YAML, export validation/warnings, sized GFM tables, Markdown round trips, tasks/tables/callouts, segmentation, colors, conflicts, source formatting and search matching. |
| Browser Integration | 64 checks passed in the full suite: left Folder Browser default-open visibility, header/close/shortcut (`Ctrl+Shift+E`) toggling, pointer resize and reload persistence, active-file auto-follow, clickable breadcrumb climb, expandable monorepo tree, recursive search filter, Pinned/Recent switcher, locked-root preservation with `Reveal Active File`, `.md`/`.markdown`/`.mdbbcode`/`.txt`/`.bbcode` (`Import`) filtering, hidden asset/empty directories behind `All` toggle, smart `.txt` BBCode vs Markdown auto-detection, `+ New File`, inline `Rename` tab syncing, context menu (`Reveal In Explorer`, `Copy Path`, `Import As BBCode`), folder drag-and-drop, light/dark/narrow (`720x480`) responsive checks, plus all 61 Visual/Hybrid/Source/Table/Outline/BÉPO checks with the left Folder Browser open. |
| Rust | 7 passed: `listDirectoryImpl` extension and hidden-folder filtering plus `Show All`, `searchDirectoryImpl` recursive matching skipping `.git`, `createFileImpl` creation and overwrite refusal, `renamePathImpl` rename and collision refusal, plus atomic writes, revision conflicts, missing files, Unicode, Save As, invalid UTF-8 and external URL scheme validation. |
| Lint | ESLint, Rust formatting check and Clippy passed. |
| Frontend & Portable Package | Production Vite build passed (non-blocking chunk-size warning); `npm run portable` succeeded building `release/BBCode Editor 0.2.8/BBCode Editor.exe` (`9,608,704` bytes). |

Browser tests use an in-memory desktop bridge. Five `0.2.8` screenshots (empty quick-launch with Pinned/Recent folders, populated light monorepo tree + single-`\n` BBCode preview, `.txt` context menu, dark Hybrid + tree + preview, and narrow `720x480` responsive layout) were inspected via `read_file`, verifying and fixing parent breadcrumb expansion and narrow drawer scrolling with zero clipping or overflow. Native smoke uses an isolated copy and a test-only WebView2 debugging connection supplied through its environment; the distributed app does not enable it.

## Native Validation

Portable Windows build and native smoke passed on `0.2.8` with zero page errors (`pageErrors: []`): real Rust autosave, no automatic companion, real `list_directory` exclusion of `portable-data` alongside live Folder Browser breadcrumbs/file highlights, Hybrid Live Preview editing, clipboard, single-instance file dispatch, tab close, recovery, legacy session backup and color preferences across a full restart. Native Hybrid and Visual screenshots were inspected via `read_file`; bundled icons and the left Folder Browser rendered cleanly with zero overlap.

| Operation | Observed Time |
| --- | --- |
| Startup With Document | 908 ms |
| Second File Launch Into Existing Window | 62 ms |
| Tab Close | 28 ms |

Single samples on the development machine including automation overhead; not performance guarantees.

## Remaining Manual Checks

1. Interactive feel check of the left Folder Browser, smart `.txt` auto-detect, Hybrid Live Preview and live Windows shortcuts under `BÉPO azerty-ctrl` with the `0.2.8` portable executable before committing/tagging `v0.2.8`.
2. Native Open/Save/Folder picker dialog interaction. Automated tests cover the dialog result handling and native filesystem operations separately.
3. Final rendering of a representative single-newline exported description on Nexus Mods; nothing was published.
4. Windows Open With association at the chosen permanent executable path; no association was changed.
5. Large-document and large-monorepo performance beyond the automated budget limits and small native timing sample.
