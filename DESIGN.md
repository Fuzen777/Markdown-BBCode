# BBCode Editor Design

## Purpose

A portable Windows x64 editor for local UTF-8 `.bbcode` documents, initially targeting Nexus Mods descriptions. Steam support is deferred.

## Application Structure

Tauri hosts SCEditor with all editor assets bundled locally. One application instance owns a tabbed window. Subsequent file launches open tabs in that window. Closing a tab keeps the application running; closing the window exits after pending writes finish.

## Editing

Switch between Visual and Source views. Copy BBCode copies the active document's source. The initial toolbar covers bold, italic, underline, strikethrough, size, colour, alignment, lists, links, images, quotes, code, and spoilers. Visual rendering approximates Nexus appearance; the published site's rendering remains authoritative.

Unknown tags and conversions that cannot safely preserve content keep the document in Source view. Simply opening or switching tabs must not rewrite files. No automatic Steam conversion is included.

## Files And Recovery

Named documents autosave after a short typing pause and flush pending changes before closing. New documents remain recoverable drafts until saved to a chosen path. Save As creates a separate file. Failed saves keep the document open with an actionable error. External changes are checked before overwriting and require conflict resolution.

Writes use a temporary file in the destination directory followed by replacement. Recovery data and preferences live in `portable-data` beside the executable. The portable folder must be writable. Recovery snapshots supplement autosave, including edits awaiting a successful file write.

## Interface

Use the system light/dark preference, a compact file toolbar, document tabs, a Visual/Source switch, a formatting toolbar, and a status bar. Standard shortcuts include Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Shift+S, and Ctrl+W. `.bbcode` association is configured manually through Windows Open With.

## Validation

Test safe formatting conversions, unknown-tag protection, file replacement, conflict detection, draft recovery, tab isolation, save failures, and portable startup. Measure application and document operations on the available machine. Verify Nexus output against documented syntax; live publishing is outside the implementation scope.
