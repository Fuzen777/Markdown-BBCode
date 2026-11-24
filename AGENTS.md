# Markdown BBCode

## Scope

Windows Markdown editor built with Tauri 2, Rust, vanilla JavaScript, Tiptap 3 and CodeMirror 6. Read DESIGN.md before changing behaviour. Ordinary .md is the default. Nexus and Steam guide BBCode are optional on-demand outputs (Steam modeled on the sibling project `..\Steam Markdown`). Supports both Portable mode (beside executable via `Portable.txt` or `portable-data`) and Installed NSIS mode (`AppData`).

## Development

Run `npm ci`, then `npm run tauri dev`. `npm run portable` compiles the binary and deploys directly to `D:\Apps\Markdown BBCode\Markdown BBCode.exe`, gracefully closing (`--graceful-close` single-instance IPC plus `WM_CLOSE` fallback) and relaunching any running instance in that folder while preserving `portable-data`. `npm run build:installer` builds a per-user signed NSIS installer. Keep dependencies locked. WebView2 is required. This project lives in its own standalone Git repository (`Fuzen777/Markdown-BBCode`); never commit builds, dependencies, signing private keys or recovery data. GitHub Releases run only on explicit `workflow_dispatch` or `release/v*` tags.

## Persistence

src/documents.js saves authoritative Markdown only. Never create, check or delete automatic BBCode companions. Export is explicit and uses revision-checked replacement confirmation. Protect open source paths and original import paths. Preserve unknown YAML, invalid source and untouched raw text. Settings and recovery stay in `portable-data` beside the executable when running portable, or under `%APPDATA%\Markdown BBCode` when installed (migrating existing `%APPDATA%\BBCode Editor` data only on first launch if needed); legacy session migration retains pending imports and backs up version-1 sessions. Window bounds persist in `window-state.json` via `tauri-plugin-window-state` with startup off-screen/taskbar rescue (`resolveRescuedWindowRect`). Non-blocking update checks (`check_for_update`), pre-update conflict/flush guards (`install_update`), and portable SHA-256 + Ed25519 minisign zip verification protect upgrades across both distribution modes.

## Editing And Conversion

src/markdown.js owns schema, Markdown conversion, block segmentation and Nexus output (retaining `\n\n` blank lines between regular paragraphs and between titles/headings and paragraphs, gluing `[list]`/`[list=1]` openings and their first `[*]` item directly to preceding blocks with `\n` after `[/list]`, and using `\n` before and after `[hr]`, `[quote]`/callout and `[code]` blocks); src/steam-bbcode.js owns Steam guide BBCode conversion; src/callout.js owns Obsidian callouts. src/bbcode-import.js owns one-time imports across Nexus and Steam tags. src/document-format.js owns frontmatter and target-aware export (`defaultTarget` overridable globally via `DocumentStore.bbcodeTarget` or explicitly via legacy `.mdbbcode` YAML). Use documentToBBCodeWithWarnings for complete document export, not the body-only converter.

src/visual-editor.js coordinates Visual, Hybrid and Source. src/block-controls.js owns Visual block menus and dragging. src/hybrid-editor.js replaces only the active enclosing block span and preserves untouched source; src/source-formatting.js shares source formatting operations. Markdown may merge adjacent compatible lists. Visual serialization can normalize an edited document. Editors are recreated on mode/tab changes, resetting undo.

The Tiptap Markdown manager uses an isolated Marked instance and validated schema JSON. Its escapeMarkdownSyntax override escapes literal pipes to distinguish spoiler delimiters. Recheck this override when upgrading the beta Markdown API. Unsupported HTML must stay raw and never execute in previews.

## Metadata And Preferences

Ordinary Markdown accepts arbitrary optional YAML; only legacy metadata has app-reserved fields. Save As does not inject metadata. Conversion validation happens at export, never as a prerequisite to saving. YAML Document API retains unknown fields/comments. Selection indicators derive from Tiptap transactions and selections.

src/colors.js owns conversion/validation; src/color-picker.js owns the picker. Session preferences.lastColor and preferences.colorMode are global portable settings. Selection never overwrites lastColor. Save input-mode changes immediately, including cancellation. Preserve editor bookmarks across the picker in every mode.

## Validation And Documentation

Run npm test, npm run test:ui, npm run lint, npm run build, Rust tests, formatting checks and Clippy. After packaging, npm run test:native (scripts/native-smoke.mjs) exercises the actual desktop bridge in an isolated folder; close other app instances first. Test runners enforce hard process-tree timeout limits via scripts/run-with-timeout.mjs (30s unit tests, 120s Playwright UI with a 20s webServer startup limit and maxFailures: 5, and 60s native smoke, terminating hung process trees with exit code 124). Because Playwright and native smoke rely on local loopback connections and Edge or WebView2, run npm run test:ui and npm run test:native outside restrictive network/process sandboxes. Keep DESIGN.md, FEATURES.md, README.md, CHANGELOG.md and VALIDATION.md aligned. Development file watching excludes runtime caches and builds.

## Hybrid Rows And Icons

segmentMarkdown preserves exact spans and emits individual top-level space blocks. Hybrid hides each block's final line terminator in CodeMirror and restores it on edits; do not append separator rows inside content blocks. Blank-line actions operate on real source spans. Controls belong in an absolute gutter. src/icons.js centralizes local Material Symbols Rounded SVG rendering and accessible hover/focus tooltips. The upstream Apache 2.0 license is under licenses and copied by the packaging script.
