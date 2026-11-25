# Markdown BBCode

A fast Windows x64 Markdown editor with optional Nexus Mods and Steam BBCode export, available as both a portable executable and a per-user installer. Built with Tauri and Tiptap.

## Running And Updates

Extract the portable release folder into a writable location (or run the portable build in `D:\Apps\Markdown BBCode`) and launch **Markdown BBCode.exe**, or install via the signed Windows NSIS setup executable. Microsoft Edge WebView2 Runtime is required. Portable launches keep settings, recovery drafts, window size/position (`window-state.json`) and WebView2 data in `portable-data` beside the executable (enabled by `Portable.txt`); installed launches store data in `%APPDATA%\Markdown BBCode`. Keep `portable-data` intact when moving a portable folder. Window position and size restore automatically on launch (rescuing any off-screen or disconnected-monitor coordinates). Both modes check GitHub Releases silently on startup or on demand from the footer version button and provide a one-click header **Update** action that flushes clean open files first (and aborts if a file conflict exists) before verifying and applying the signed update.

## Documents And Saving

1. Create ordinary `.md` files, or open `.md`, `.markdown`, `.mdbbcode` and Markdown/plain `.txt` documents in tabs.
2. **Save** names a draft. Named files autosave after a 750 ms typing pause. Only Markdown is saved; existing `.bbcode` files are untouched.
3. **Copy BBCode** converts the current document using the selected `Nexus` or `Steam` dialect. Nexus preserves blank lines (`\n\n`) between regular paragraphs and between titles/headings and paragraphs, glues `[list]`/`[list=1]` openings and their first `[*]` item directly to preceding blocks (`...[list][*]...`) with `\n` after `[/list]`, and uses single newlines (`\n`) before and after `[hr]` dividers, `[quote]` blocks (including callouts), and `[code]` blocks (while keeping extra intentional blank lines). Steam generates Steam guide BBCode (`[h1]`–`[h3]`, `[strike]`, `[olist]`, `› ` flattened nested lists, `[table]`, `[hr][/hr]`, `[noparse]`, bare YouTube/Steam/Workshop embeds and glued `[code]`). **Export BBCode…** writes to a chosen `.bbcode` or `.txt` file and asks before replacing an existing file. Lossy conversions show warnings before export.
4. **Import BBCode** (and auto-detected Nexus or Steam BBCode-formatted `.txt` or `.bbcode` files) creates a one-time Markdown draft with formatting-loss review. The original file is protected.

Clean external changes and non-intersecting line additions or removals auto-sync automatically (with a **View Diff** / **Revert Sync** review banner). Intersecting external conflicts open an interactive Unified or Side-by-Side **Diff View** offering per-hunk **Keep Mine**, **Use Disk**, and **Keep Both** merging (`Apply Merged`) alongside **Load Disk Version**, **Keep My Edits**, or **Save As**. If an open file is deleted externally, the notice bar offers **Review Missing File** and **Close Tab**; clean tabs close and let the app quit without recreating the deleted file, while tabs with unsaved edits open **File Missing On Disk** (**Keep My Edits**, **Save As**, **Close Without Saving**, **Cancel**) before closing or quitting. Other save failures prevent closing until resolved. Unnamed drafts and open tabs recover after restart; snapshots are written after a 250 ms pause. Changes since the latest successful write can be lost on abrupt power loss.

## Editing Modes

| Mode | Behaviour |
| --- | --- |
| Visual | Formatted editing, Markdown paste parsing into formatted blocks/marks, selection-aware toolbar, block menus, drag handles and slash insertion in an empty paragraph. |
| Hybrid | Click any block near a word to edit its Markdown with Obsidian-style Live Preview (cursor lines show raw syntax while sibling lines render live), interactive task checkboxes, link popovers, a live-filtered `/` menu, `Turn Into`/`Wrap In` controls and untouched source preservation. |
| Source | Edit the complete file, including optional YAML. |

Visual block menus insert, duplicate, delete, move or change block types, and gutter handles center vertically on horizontal rules (`---`) in both Visual and Hybrid. `Alt+Up`/`Down` moves the selected Visual block, active Hybrid block or Source line. Hybrid provides per-block actions (`Move Up`, `Move Down`, `Turn Into`, `Duplicate`, `Delete`), multi-block `Wrap In`/`Delete`, smart `Enter`/`Tab` list and quote continuation, `/` alias filtering and boundary `Backspace`/`Delete` across blank separators; `ArrowUp`/`ArrowDown` crosses wrapped lines and adjacent blocks while `Escape` restores the preview. Adjacent compatible lists follow Markdown rules and may merge into one list.

Visual edits can normalize Markdown. Merely opening a file or switching modes preserves it. Undo history resets when switching modes or tabs. Unsupported syntax remains available in Source or as raw Hybrid blocks.

## Formatting

Headings, bold, italic, strike, lists, tasks, tables, quotes, code (including 4+ backtick ` ```` ` / tilde `~~~~` fences so backtick runs can be shown literally inside code blocks across Visual, Hybrid, and Source), links and web images are supported. Obsidian callouts accept types, custom titles, nested content and `+`/`-` folding markers:

```markdown
> [!warning]- Before Installing
> Back up your files.
```

Edit callout titles directly in Visual; use Hybrid or Source to change type and default folding. Clicking the folding control only changes the current view.

| Additional Format | Source |
| --- | --- |
| Inline Spoiler | `||Hidden text||` |
| Multiple-Paragraph Spoiler | Standalone `||` lines around paragraphs. |
| Center | `<div style="text-align: center">` around Markdown blocks, followed by `</div>`. |
| Color | `<span style="color: #e6a050">Text</span>` |

The Color swatch applies the last-used color; its arrow opens Hex/RGB/HSL controls. Hex accepts an optional #. Color and input mode persist across launches. Cancel leaves content unchanged. Selection is preserved across the picker in all modes.

## YAML And Export

Ordinary Markdown can contain arbitrary YAML without application-specific fields. Save As preserves source without adding metadata. Legacy `.mdbbcode` headers remain supported, including their visual Target dropdown (`Nexus Mods` or `Steam`). Invalid metadata never prevents saving the source, but can prevent export.

BBCode is generated only on request. On Nexus, tables become readable text, tasks become lists and callouts become quotes. On Steam, tables use native `[table]` tags, nested lists flatten with `› ` prefixes, `h4`–`h6` downgrade to `[h3]`, colors and centered blocks are stripped with warnings, and standalone YouTube, Steam store and Workshop URLs stay bare for Steam embeds. Review export warnings and check final rendering on the target site. Arbitrary HTML and unsupported conversion syntax can block export. Images require web URLs; local attachment management is not included. The app works offline except for loading remote images.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+N | New Document |
| Ctrl+O | Open Files |
| Ctrl+S | Save / Name Draft |
| Ctrl+Shift+S | Save As |
| Ctrl+W | Close Tab (Or Middle-Click Tab) |
| Ctrl+Shift+C | Copy BBCode |
| Ctrl+B / Ctrl+I | Toggle Bold / Italic (Visual, Hybrid, Source) |
| Ctrl+K | Insert Or Edit Link (Visual, Hybrid, Source) |
| Ctrl+Shift+X | Toggle Strikethrough (Visual, Hybrid, Source) |
| Ctrl+E | Toggle Inline Code (Visual, Hybrid, Source) |
| Ctrl+Z / Ctrl+Y | Undo / Redo (Ctrl+Shift+Z Also Redoes In Visual & Hybrid) |
| Ctrl+A | Select Document (Visual) Or Active Block (Hybrid) |
| Ctrl+Alt+0–6 | Paragraph, Headings 1–3, Task, Bullet, Numbered List |
| Alt+Up / Alt+Down | Move Active Block Or Line Up / Down |
| Ctrl+D | Duplicate Active Block Or List Item |
| Ctrl+Shift+P | Toggle BBCode Preview Pane |
| Ctrl+Shift+E | Toggle Left Folder Browser |
| Ctrl+F / Ctrl+H | Find / Find And Replace |

Cross-mode `Ctrl` shortcuts prioritize Windows virtual keys (`VK_A`–`VK_Z`) so split `Ctrl` layouts such as `BÉPO azerty-ctrl` trigger the expected shortcuts without affecting normal BÉPO typing, `AltGr` characters or native clipboard actions.

Use Windows **Open With** to associate files with the executable at its permanent location. Subsequent launches open tabs in the existing window. No association changes automatically. Older BBCode recovery is offered for explicit import and backed up as `session-v1-backup.json`.

## Development

Requires Node.js, Rust's Windows MSVC toolchain, Visual Studio C++ Build Tools and WebView2.

```powershell
npm ci
npm run tauri dev
npm test
npm run test:ui
npm run lint
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run portable
npm run build:installer
npm run test:native
```

Browser tests use installed Microsoft Edge. Automated test runners enforce process-tree timeout guards (`30s` unit tests, `120s` Playwright UI with a `20s` server startup limit, and `60s` native smoke). `npm run portable` deploys directly to `D:\Apps\Markdown BBCode\Markdown BBCode.exe`, gracefully closing and relaunching an already-open instance in that directory. Signed GitHub Releases (NSIS installer, portable archive and updater manifests) build via `.github/workflows/release.yml` only on manual dispatch or `release/v*` tags. Build the frontend before Rust checks on a clean checkout. Close other instances before running the isolated native smoke test.

## Hybrid Blank Lines And Icons

Hybrid shows each real top-level blank line as its own editable row. Click it to type, or use its gutter menu to duplicate, delete or move it. Lists, callouts and code retain their internal blank lines. Controls sit in the gutter without adding empty rows. Moving or removing separators can change how Markdown groups paragraphs and lists.

File and formatting buttons use Google Material Symbols Rounded icons bundled with the app (alongside `NexusMods.svg` and `Steam.svg` for BBCode dialect switching). Hover or focus a button to see its action and shortcut. Icons work offline; their Apache 2.0 license is included in the licenses folder.

Block-type and block-action entries in Turn Into, Block Actions, Insert and slash menus show matching icons alongside their text, including distinct Heading 1, 2 and 3 symbols.

## Shortcuts, Preview, Outline And Search

Use `Ctrl+Shift+E` (or the header toggle and close button) for the resizable left Folder Browser to open mod workspaces cleanly: it auto-follows active files, climbs breadcrumbs up to a monorepo root, remembers Pinned and Recent folders, hides non-text asset folders (including asset-only `Dist`/`Build`, while keeping `Dist`/`Build` folders visible whenever they contain readable files or symlinks) unless `All` is enabled, treats symlinks, NTFS directory junctions, and hard links pointing to readable files or folders natively (preserving workspace paths and links on save), refreshes automatically whenever Markdown BBCode becomes the active window, shows `.bbcode` files with an `Import` badge, auto-detects BBCode vs Markdown/plain `.txt` files on open, filters recursively, and supports `+ New File`, inline `Rename` (`F2`/context menu), `Reveal In Explorer`, `Copy Path`, and dropping folders onto the window. Use `Ctrl+F` to search and `Ctrl+H` to replace across Visual, Hybrid and Source, paste an HTTP(S) URL onto selected text to wrap a link directly, toggle the globally persisted right-side Document Outline (`Off`, `Float` edge ticks or `Dock` sidebar) to jump between headings, switch editor width between capped `Page` (`800px` centered default) and `Full` via the document bar `Width` toggle across Visual, Hybrid and Source, `Tab`/`Shift+Tab` to indent list items, or toggle the resizable, scroll-synced Nexus/Steam BBCode preview pane with `Ctrl+Shift+P`. Drop `.md`, `.markdown`, `.mdbbcode`, `.bbcode`, `.txt` files or folders directly onto the window to open or import them. Use the Table toolbar grid, hover `+` rails, row/column drag handles or border right-click menus for table edits, hover links, code blocks or images in Visual mode (or hover/`Ctrl+Click` links and toggle task checkboxes directly in Hybrid) for quick inline controls, Shift/Ctrl+Click or gutter-marquee handles for multi-block operations (`Move`, `Duplicate`, `Wrap In`, `Delete`), click anywhere inside a Hybrid block to land the cursor near that word, and select text in Visual or Hybrid mode for the expanded formatting bubble bar.

To check Markdown style, dock the Outline (`Dock`) and switch its header to the `Lint` tab, then choose `Enable Linting`. markdownlint then checks the open document in the background shortly after you stop typing, groups problems by rule, and jumps to a problem when you click it. The footer shows the problem count (click it to open the Lint tab); the eye-off button in the Lint tab turns linting off again. Linting is off by default and loads nothing until enabled; documents over 300 KB are linted only when you click `Lint Now`.

Open Settings with the gear button or `Ctrl+,`. `General` repeats the dialect, width and outline switches. `Linting` sets the lint delay, the large file threshold and the rule preset, and lists every markdownlint rule: search or filter them, turn rules on or off, mark them as `Error` instead of `Warning`, change their options or `Reset` them. If a `.markdownlint.jsonc` or `.markdownlint.json` file sits in the document's folder or a parent folder, its rules are used instead and Settings shows them as read-only.

While linting is on, blocks with problems get a thin amber or red mark at their left edge in Visual and Hybrid, the block you are editing in Hybrid underlines each problem (hover it for details), and the floating outline shows problem ticks. Turn these off with `Show Inline Markers` in Settings. Problems markdownlint can repair show a `Fix` button, and `Fix All` in the Lint tab repairs them all at once. In Source you can undo a fix with `Ctrl+Z`; in Visual mode the app asks first, because fixing there resets undo history.

The Lint tab also lists what your Nexus or Steam export would drop or change (for example Steam has no heading below level 3), under `BBCode (Nexus)` or `BBCode (Steam)`. By default this only happens for `.mdbbcode` files; choose `All Markdown Files` or `Off` under `BBCode Export Warnings` in Settings. To turn it on or off for one file, use `BBCode Warnings For This File` in the Lint tab: it saves `bbcodeLint: true` (or `false`) in that file's front matter, which wins over the global setting. Switch the Lint tab to `Folder` to check every Markdown file under the folder open in the Folder Browser: it runs only when you open it or press the refresh button, can be cancelled, and opens a file at the problem when you click it.
