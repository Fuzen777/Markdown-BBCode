# BBCode Editor Features

## Documents

| Feature | Behaviour |
| --- | --- |
| Local Files | Open UTF-8 `.bbcode` and `.txt` files; save new files as `.bbcode`. |
| Tabs | Multiple documents in a single window, with change and error indicators. |
| Single Instance | Files launched from Windows open in the existing application. |
| Autosave | Named documents save after a 750 ms typing pause and before closing. |
| Draft Recovery | Unnamed documents and pending edits are recorded after a 250 ms pause. Closed unnamed drafts can be reopened using Drafts. |
| Save As | Save a separate copy, with revision-checked replacement of an existing target. |
| External Changes | Disk changes raise a conflict instead of being silently overwritten. |
| Failed Saves | Errors remain visible and prevent closing until resolved. |

## Editing

SCEditor provides Visual and Source views. Copy BBCode copies the active document's source. Supported visual controls cover bold, italic, underline, strikethrough, size, colour, alignment, lists, links, images, quotes, code, and spoilers. Spoilers appear expanded in the editor. Nexus list syntax is used for generated lists.

Unknown tags and formatting that cannot safely round-trip remain in Source. Opening, switching modes, or changing tabs without editing preserves the original source. Visual appearance is an approximation of Nexus rendering.

## Windows Integration

Portable Windows x64 executable using the installed Microsoft Edge WebView2 runtime. All editor assets are bundled. Settings, recovery snapshots, and WebView2 data are kept in `portable-data` beside the executable. Light/dark appearance follows the system. Standard file shortcuts and manual Open With association are supported.

## Current Limits

Steam-specific formatting is deferred. Images are referenced by URL; image uploads and managed local attachments are not included. No Nexus login or publishing integration is included. Complex or unsupported markup remains source-editable. Visual conversion and undo behaviour depend on SCEditor; final appearance should be checked on Nexus.
