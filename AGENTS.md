# BBCode Editor

## Scope

Portable Windows Markdown editor built with Tauri 2, Rust, vanilla JavaScript, Tiptap 3 and CodeMirror 6. Read DESIGN.md before changing behaviour. Ordinary .md is the default. Nexus BBCode is optional on-demand output; Steam is deferred. Retain the existing portable identity.

## Development

Run npm ci, then npm run tauri dev. npm run portable creates a versioned folder. Keep dependencies locked. WebView2 is required. This project shares its parent Git repository: stage and commit only this project's files. Never commit builds, dependencies or recovery data.

## Persistence

src/documents.js saves authoritative Markdown only. Never create, check or delete automatic BBCode companions. Export is explicit and uses revision-checked replacement confirmation. Protect open source paths and original import paths. Preserve unknown YAML, invalid source and untouched raw text. Portable settings/recovery belong beside the executable; legacy session migration retains pending imports and backs up version-1 sessions.

## Editing And Conversion

src/markdown.js owns schema, Markdown conversion, block segmentation and Nexus output; src/callout.js owns Obsidian callouts. src/bbcode-import.js owns one-time imports. src/document-format.js owns frontmatter and legacy target-aware export. Use documentToBBCodeWithWarnings for complete document export, not the body-only converter.

src/visual-editor.js coordinates Visual, Hybrid and Source. src/block-controls.js owns Visual block menus and dragging. src/hybrid-editor.js replaces only the active enclosing block span and preserves untouched source; src/source-formatting.js shares source formatting operations. Markdown may merge adjacent compatible lists. Visual serialization can normalize an edited document. Editors are recreated on mode/tab changes, resetting undo.

The Tiptap Markdown manager uses an isolated Marked instance and validated schema JSON. Its escapeMarkdownSyntax override escapes literal pipes to distinguish spoiler delimiters. Recheck this override when upgrading the beta Markdown API. Unsupported HTML must stay raw and never execute in previews.

## Metadata And Preferences

Ordinary Markdown accepts arbitrary optional YAML; only legacy metadata has app-reserved fields. Save As does not inject metadata. Conversion validation happens at export, never as a prerequisite to saving. YAML Document API retains unknown fields/comments. Selection indicators derive from Tiptap transactions and selections.

src/colors.js owns conversion/validation; src/color-picker.js owns the picker. Session preferences.lastColor and preferences.colorMode are global portable settings. Selection never overwrites lastColor. Save input-mode changes immediately, including cancellation. Preserve editor bookmarks across the picker in every mode.

## Validation And Documentation

Run npm test, npm run test:ui, npm run lint, npm run build, Rust tests, formatting checks and Clippy. After packaging, scripts/native-smoke.mjs exercises the actual desktop bridge in an isolated folder; close other app instances first. Keep DESIGN.md, FEATURES.md, README.md, CHANGELOG.md and VALIDATION.md aligned. Development file watching excludes runtime caches and builds.
