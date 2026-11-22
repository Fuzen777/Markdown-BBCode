# BBCode Editor

## Scope

Portable Windows app built with Tauri 2, Rust, vanilla JavaScript and Tiptap 3. Read DESIGN.md before changing user-facing behaviour. MDBBCode documents contain a YAML header plus Markdown; the full source is authoritative; Nexus BBCode is generated beside it. Steam is deferred.

## Development

Run `npm ci`, then `npm run tauri dev`. `npm run portable` creates a versioned release folder. Keep dependencies locked. WebView2 is required.

## Persistence

Save Markdown independently before output generation. Never silently replace existing or externally changed files. Preserve untouched source. Keep legacy recovery as pending imports and back up version-1 sessions. Imports must not overwrite their original BBCode. Export ownership records include the source path as well as the output revision. Settings and recovery belong beside the executable.

## Conversion

src/markdown.js owns the schema, custom spoiler/center/color extensions, Markdown conversion and Nexus output. src/bbcode-import.js owns one-time imports and loss warnings. The Tiptap Markdown manager is used directly with an isolated Marked instance; the visual editor works with validated schema JSON. Its escapeMarkdownSyntax override escapes literal pipes to distinguish them from spoiler delimiters. Recheck this override when upgrading Tiptap Markdown, which is a beta API. Visual editors are recreated on tab/mode changes, resetting undo history.

## Validation And Documentation

Run npm test, npm run test:ui, npm run lint, npm run build, Rust tests and Clippy. After packaging, scripts/native-smoke.mjs exercises the real desktop bridge in an isolated test folder. Keep DESIGN.md, FEATURES.md, README.md, CHANGELOG.md and VALIDATION.md aligned. Do not commit builds, dependencies or recovery data. This project shares its parent Git repository; stage and commit only this project's files.

## Metadata And Toolbar State

src/document-format.js owns frontmatter parsing, metadata validation, .mdbbcode preparation and target-aware export. Use documentToBBCode for full document export/copy; markdownToBBCode only accepts the body. Visual editing preserves the header; Source contains the complete file. Never drop unknown properties or overwrite invalid metadata during autosave. Plain .md/.markdown remain supported. YAML is parsed using the [yaml Document API](https://eemeli.org/yaml/#documents), retaining unknown fields and comments. Selection indicators derive from Tiptap transactions and selections, never stale toolbar values. Development file watching excludes portable runtime caches and build output.


## Output Error Actions

Missing-header errors carry action: initialize; other conversion failures offer Fix Source. Revalidate current source before initialization so stale notices cannot replace metadata entered since the error. Preserve source-conflict and companion-replacement checks when initializing.
