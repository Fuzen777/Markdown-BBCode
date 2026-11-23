# BBCode Editor

A portable Windows x64 Markdown editor with optional Nexus Mods BBCode export. Built with Tauri and Tiptap.

## Running

Extract the portable folder into a writable location and run **BBCode Editor.exe**. Microsoft Edge WebView2 Runtime is required. Settings and recovery stay in `portable-data` beside the executable. Keep that folder when moving or upgrading the app, with both versions closed.

## Documents And Saving

1. Create ordinary `.md` files, or open `.md`, `.markdown` and existing `.mdbbcode` documents in tabs.
2. **Save** names a draft. Named files autosave after a 750 ms typing pause. Only Markdown is saved; existing `.bbcode` files are untouched.
3. **Copy BBCode** converts the current document for Nexus. **Export BBCode…** writes to a chosen file and asks before replacing an existing file. Callouts, tables and tasks show conversion-loss warnings before export.
4. **Import BBCode** creates a one-time Markdown draft with formatting-loss review. The original BBCode is protected.

Source conflicts offer **Load Disk Version**, **Keep My Edits**, or **Save As**. Save failures prevent closing until resolved. Unnamed drafts and open tabs recover after restart; snapshots are written after a 250 ms pause. Changes since the latest successful write can be lost on abrupt power loss.

## Editing Modes

| Mode | Behaviour |
| --- | --- |
| Visual | Formatted editing, selection-aware toolbar, block menus, drag handles and slash insertion in an empty paragraph. |
| Hybrid | Click a block to edit its Markdown with distinguished syntax markers while other blocks stay rendered. Lists and callouts open as a whole enclosing block. Untouched source is preserved. |
| Source | Edit the complete file, including optional YAML. |

Visual block menus insert, duplicate, delete, move or change block types. Alt+Up/Down moves the selected Visual block. Hybrid provides per-block actions, insertion and drag movement. At the start/end of an active Hybrid block, Up/Down moves to its neighbour; Escape restores the preview. Adjacent compatible lists follow Markdown rules and may merge into one list.

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
node scripts/native-smoke.mjs
```

Browser tests use installed Microsoft Edge. Portable builds appear under `release/BBCode Editor <version>`. Build the frontend before Rust checks on a clean checkout. Close other instances before running the isolated native smoke test.

## Hybrid Blank Lines And Icons

Hybrid shows each real top-level blank line as its own editable row. Click it to type, or use its gutter menu to duplicate, delete or move it. Lists, callouts and code retain their internal blank lines. Controls sit in the gutter without adding empty rows. Moving or removing separators can change how Markdown groups paragraphs and lists.

File and formatting buttons use Google Material Symbols Rounded icons bundled with the app. Hover or focus a button to see its action and shortcut. Icons work offline; their Apache 2.0 license is included in the licenses folder.

Block-type and block-action entries in Turn Into, Block Actions, Insert and slash menus show matching icons alongside their text, including distinct Heading 1, 2 and 3 symbols.

## Shortcuts, Preview And Search

Use `Ctrl+F` to search and `Ctrl+H` to replace across Visual, Hybrid and Source, or toggle the live Nexus BBCode preview pane with `Ctrl+Shift+P` (or the Preview BBCode button). Drop `.md`, `.markdown`, `.mdbbcode`, `.bbcode` or `.txt` files directly onto the window to open or import them. Inside Visual tables and callouts, use the contextual table bar and callout header selectors to edit structure directly.
