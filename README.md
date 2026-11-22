# BBCode Editor

A portable Windows x64 editor for Nexus Mods descriptions, built with Tauri and SCEditor. Documents are ordinary UTF-8 `.bbcode` files.

## Running

Extract the entire portable folder into a writable location and run **BBCode Editor.exe**. Microsoft Edge WebView2 Runtime must be installed (normally present on Windows 11). If it is missing, install it from [Microsoft](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

The application creates `portable-data` beside its executable for preferences, draft recovery, and its browser cache. Keep this folder when moving the application. The application is not digitally signed.

## Editing And Files

1. Use **New** or **Open** to work with documents in tabs.
2. Switch between **Visual** and **Source**. Unsupported tags or formatting that cannot safely round-trip remain editable in Source.
3. Use **Save** to choose a filename for a draft, or **Save As** for a separate copy. Existing files autosave after a short pause in typing.
4. Use **Copy BBCode** to copy the source for pasting into Nexus Mods.

Closing an unnamed, nonempty tab keeps it as a recovery draft. Use **Drafts** to reopen closed drafts. Open tabs and drafts are restored on startup. Closing the window finishes pending saves first. Failed saves keep the window open; retry after fixing the problem or use Save As to choose another location.

If a file changes outside the app, choose **Load Disk Version**, **Keep My Edits**, or **Save As**. Loading the disk version discards the local edits; keeping your edits replaces the current disk version after a second revision check.

To open `.bbcode` files by double-clicking, right-click a file in Windows, choose **Open With → Choose Another App**, browse to **BBCode Editor.exe**, and select it as the default. Keep the executable at that location. Subsequent file launches open tabs in the existing app window.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+N | New Document |
| Ctrl+O | Open Files |
| Ctrl+S | Save / Name Draft |
| Ctrl+Shift+S | Save As |
| Ctrl+W | Close Tab |
| Ctrl+Shift+C | Copy BBCode |

## Formatting And Limits

The toolbar includes text styles, sizes, colours, alignment, lists, links, images, quotes, code, and spoilers. Spoilers display expanded while editing. Visual appearance approximates Nexus; check the final description on Nexus before publishing. Steam-specific formatting is not implemented.

The editor and all its assets work offline. Remote images load from their URLs when connected; they are not uploaded, bundled with documents, or cached as managed attachments. Unknown markup can be edited and copied in Source without requiring visual conversion. Switching between modes may reset the editor's undo history; file and recovery persistence do not depend on undo history.

Recovery snapshots are written after a 250 ms pause, and named files autosave after a 750 ms pause. An abrupt power loss can lose changes since the latest successful write. Keep normal backups of important documents.

## Development

Requires Node.js, Rust's Windows MSVC toolchain, Visual Studio C++ Build Tools, and WebView2.

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
```

Browser integration tests use installed Microsoft Edge. Portable output is created under `release/BBCode Editor`. Generated editor assets and icons are prepared automatically before frontend development and builds. Rust tests need these assets prepared first (`npm run build` on a clean checkout).
