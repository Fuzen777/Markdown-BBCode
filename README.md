# BBCode Editor

A portable Windows x64 visual Markdown editor that generates Nexus Mods BBCode beside each Markdown document. Built with Tauri and Tiptap.

## Running

Extract the portable folder into a writable location and run **BBCode Editor.exe**. Microsoft Edge WebView2 Runtime is required. Settings, recovery drafts and browser cache are kept in `portable-data` beside the executable. Keep that folder when moving the app.

## Documents And Saving

1. Use **New** or **Open** for Markdown documents in tabs. **Visual** provides formatted editing; **Source** edits Markdown directly.
2. **Save** names a new draft. Named documents autosave after a 750 ms typing pause. Saving `Description.md` also generates `Description.bbcode` next to it.
3. **Copy BBCode** converts and copies the current document for Nexus Mods.
4. **Import BBCode** makes a one-time Markdown draft. Unsupported formatting is reported before acceptance. Save it under the suggested `.imported.md` name; the original BBCode stays intact.

Markdown is the editable original. Changes to the generated BBCode are not imported back. Existing or externally changed BBCode requires confirmation before replacement. If conversion or output saving fails, Markdown still saves and **BBCode Out Of Date** remains visible. Correct unsupported source or use **Regenerate BBCode** to retry.

Source conflicts offer **Load Disk Version**, **Keep My Edits**, or **Save As**. Source save failures prevent closing until resolved. Output-only failures allow explicitly closing with outdated BBCode after Markdown has saved.

Unnamed documents are recovered after restarting. Closed unnamed documents remain available through **Drafts**. Recovery snapshots are written after a 250 ms pause; changes since the latest successful write can be lost on abrupt power loss.

## Formatting

Standard formatting includes headings, bold, italic, strikethrough, lists, quotes, code, links and images. Additional formatting is applied using toolbar buttons:

| Format | Markdown Source |
| --- | --- |
| Inline Spoiler | `||Hidden text||` |
| Multiple-Paragraph Spoiler | Standalone `||` lines around the paragraphs. |
| Center | `<div style="text-align: center">` around Markdown blocks, followed by `</div>`. |
| Color | `<span style="color: #e6a050">Text</span>` |

Spoilers stay expanded during editing. Colors use hexadecimal values. Tables, task lists and arbitrary HTML are not supported for visual editing or BBCode conversion; their Markdown remains saved and source-editable. Ordered lists must start at 1. Images require web URLs; uploading or managing local attachments is not included. The app works offline except for loading remote images.

Visual editing may normalize Markdown syntax after an edit; simply opening a file preserves its source. Switching tabs or modes resets visual undo history. Nexus appearance may differ; check the final description there. Steam support is deferred.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+N | New Document |
| Ctrl+O | Open Files |
| Ctrl+S | Save / Name Draft |
| Ctrl+Shift+S | Save As |
| Ctrl+W | Close Tab |
| Ctrl+Shift+C | Copy BBCode |

Use Windows **Open With** to associate `.md` files with the executable if desired. Subsequent file launches open tabs in the existing window. No association is changed automatically.

## Upgrading From 0.1.0

Close the previous app before launching this release. To bring across recovery data, copy the old `portable-data` folder beside the new executable while both apps are closed. Legacy BBCode recovery appears under **Recovered BBCode** for explicit one-time import. The original session is backed up as `session-v1-backup.json` before migration. The previous release and its documents are not modified by installing the new folder.

## Development

Requires Node.js, Rust's Windows MSVC toolchain, Visual Studio C++ Build Tools and WebView2.

```powershell
npm ci
npm run tauri dev
```

```powershell
npm test
npm run test:ui
npm run lint
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run portable
node scripts/native-smoke.mjs
```

Browser tests use installed Microsoft Edge. `npm run portable` produces `release/BBCode Editor <version>`. Icons are prepared automatically. Build the frontend before running Rust checks on a clean checkout.
