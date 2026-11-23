# Markdown BBCode

A fast Windows x64 Markdown editor with optional Nexus Mods BBCode export, available as both a portable executable and a per-user installer. Built with Tauri and Tiptap.

## Running And Updates

Extract the portable release folder into a writable location (or run the portable build in `D:\Apps\Markdown BBCode`) and launch **Markdown BBCode.exe**, or install via the signed Windows NSIS setup executable. Microsoft Edge WebView2 Runtime is required. Portable launches keep settings, recovery drafts and WebView2 data in `portable-data` beside the executable (enabled by `Portable.txt`); installed launches store data in `%APPDATA%\Markdown BBCode`. Keep `portable-data` intact when moving a portable folder. Both modes check GitHub Releases silently on startup or on demand from the footer version button and provide a one-click header **Update** action that flushes clean open files first (and aborts if a file conflict exists) before verifying and applying the signed update.

## Documents And Saving

1. Create ordinary `.md` files, or open `.md`, `.markdown`, `.mdbbcode` and Markdown/plain `.txt` documents in tabs.
2. **Save** names a draft. Named files autosave after a 750 ms typing pause. Only Markdown is saved; existing `.bbcode` files are untouched.
3. **Copy BBCode** converts the current document for Nexus using single newlines (`\n`) between adjacent blocks while preserving extra intentional blank lines (`\n\n\n` -> `\n\n`). **Export BBCode…** writes to a chosen file and asks before replacing an existing file. Callouts, tables and tasks show conversion-loss warnings before export.
4. **Import BBCode** (and auto-detected BBCode-formatted `.txt` or `.bbcode` files) creates a one-time Markdown draft with formatting-loss review. The original file is protected.

Source conflicts offer **Load Disk Version**, **Keep My Edits**, or **Save As**. Save failures prevent closing until resolved. Unnamed drafts and open tabs recover after restart; snapshots are written after a 250 ms pause. Changes since the latest successful write can be lost on abrupt power loss.

## Editing Modes

| Mode | Behaviour |
| --- | --- |
| Visual | Formatted editing, selection-aware toolbar, block menus, drag handles and slash insertion in an empty paragraph. |
| Hybrid | Click any block near a word to edit its Markdown with Obsidian-style Live Preview (cursor lines show raw syntax while sibling lines render live), interactive task checkboxes, link popovers, a live-filtered `/` menu, `Turn Into`/`Wrap In` controls and untouched source preservation. |
| Source | Edit the complete file, including optional YAML. |

Visual block menus insert, duplicate, delete, move or change block types, and gutter handles center vertically on horizontal rules (`---`) in both Visual and Hybrid. `Alt+Up`/`Down` moves the selected Visual block, active Hybrid block or Source line. Hybrid provides per-block actions (`Move Up`, `Move Down`, `Turn Into`, `Duplicate`, `Delete`), multi-block `Wrap In`/`Delete`, smart `Enter`/`Tab` list and quote continuation, `/` alias filtering and boundary `Backspace`/`Delete` across blank separators; `ArrowUp`/`ArrowDown` crosses wrapped lines and adjacent blocks while `Escape` restores the preview. Adjacent compatible lists follow Markdown rules and may merge into one list.

Visual edits can normalize Markdown. Merely opening a file or switching modes preserves it. Undo history resets when switching modes or tabs. Unsupported syntax remains available in Source or as raw Hybrid blocks.

## Formatting

Headings, bold, italic, strike, lists, tasks, tables, quotes, code, links and web images are supported. Obsidian callouts accept types, custom titles, nested content and `+`/`-` folding markers:

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

Ordinary Markdown can contain arbitrary YAML without application-specific fields. Save As preserves source without adding metadata. Legacy `.mdbbcode` headers remain supported, including their visual Target dropdown. Nexus is supported; Steam is deferred. Invalid metadata never prevents saving the source, but can prevent export.

BBCode is generated only on request. Tables become readable text, tasks become lists and callouts become quotes; review the export warning and check final rendering on Nexus. Arbitrary HTML and unsupported conversion syntax can block export. Images require web URLs; local attachment management is not included. The app works offline except for loading remote images.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+N | New Document |
| Ctrl+O | Open Files |
| Ctrl+S | Save / Name Draft |
| Ctrl+Shift+S | Save As |
| Ctrl+W | Close Tab |
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

File and formatting buttons use Google Material Symbols Rounded icons bundled with the app. Hover or focus a button to see its action and shortcut. Icons work offline; their Apache 2.0 license is included in the licenses folder.

Block-type and block-action entries in Turn Into, Block Actions, Insert and slash menus show matching icons alongside their text, including distinct Heading 1, 2 and 3 symbols.

## Shortcuts, Preview, Outline And Search

Use `Ctrl+Shift+E` (or the header toggle and close button) for the resizable left Folder Browser to open mod workspaces cleanly: it auto-follows active files, climbs breadcrumbs up to a monorepo root, remembers Pinned and Recent folders, hides non-text asset folders unless `All` is enabled, shows `.bbcode` files with an `Import` badge, auto-detects BBCode vs Markdown/plain `.txt` files on open, filters recursively, and supports `+ New File`, inline `Rename` (`F2`/context menu), `Reveal In Explorer`, `Copy Path`, and dropping folders onto the window. Use `Ctrl+F` to search and `Ctrl+H` to replace across Visual, Hybrid and Source, paste an HTTP(S) URL onto selected text to wrap a link directly, toggle the right-side Document Outline (`Off`, `Float` edge ticks or `Dock` sidebar) to jump between headings, switch editor width between capped `Page` (`800px` centered default) and `Full` via the document bar `Width` toggle across Visual, Hybrid and Source, `Tab`/`Shift+Tab` to indent list items, or toggle the resizable, scroll-synced Nexus BBCode preview pane with `Ctrl+Shift+P`. Drop `.md`, `.markdown`, `.mdbbcode`, `.bbcode`, `.txt` files or folders directly onto the window to open or import them. Use the Table toolbar grid, hover `+` rails, row/column drag handles or border right-click menus for table edits, hover links, code blocks or images in Visual mode (or hover/`Ctrl+Click` links and toggle task checkboxes directly in Hybrid) for quick inline controls, Shift/Ctrl+Click or gutter-marquee handles for multi-block operations (`Move`, `Duplicate`, `Wrap In`, `Delete`), click anywhere inside a Hybrid block to land the cursor near that word, and select text in Visual or Hybrid mode for the expanded formatting bubble bar.
