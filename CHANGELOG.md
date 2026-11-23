# Changelog

## 0.2.3 — 2026-11-23

1. Fixed Visual gutter overlap over block text, added a Turn Into divider and ensured Delete Block remains visible without clipping.
2. Added outside-click dismissal to Hybrid Insert/slash menus, boundary disabled states to Hybrid Block Actions and Enter-to-submit plus link editing/removal to link dialogs.
3. Added Hybrid and Source formatting parity: live toolbar indicators, toggleable inline styles, Clear formatting support and `Ctrl+B`/`Ctrl+I` shortcuts.
4. Added a contextual Visual table toolbar, inline callout type and folding selectors, toggleable live BBCode preview pane (`Ctrl+Shift+P`), cross-mode Find & Replace (`Ctrl+F`/`Ctrl+H`), window file drag-and-drop and footer word counts.

## 0.2.2 — 2026-11-23

1. Added icon-and-text entries to Turn Into, Block Actions, Insert and slash menus, including distinct heading-level symbols and block actions (Duplicate, Move Up, Move Down, Delete).

## 0.2.1 — 2026-11-23

1. Removed phantom Hybrid rows by separating real top-level blank lines into editable blocks and moving controls into the gutter.
2. Preserved source line endings and internal container spacing across editing and blank-line actions.
3. Replaced file, formatting and block controls with locally bundled Material Symbols Rounded icons and accessible hover/focus tooltips.

4. Corrected dependency lockfile version metadata to match the installed packages.

## 0.2.0 — 2026-11-23

1. Made ordinary .md files the default, with optional YAML and source-only autosave. Existing .mdbbcode files remain supported.
2. Removed automatic BBCode companions; Copy BBCode and explicit Export BBCode convert on demand with loss warnings and replacement protection.
3. Added tables, task lists and nested Obsidian callouts with titles and folding.
4. Added Visual block menus, drag reordering and slash insertion.
5. Added Hybrid editing: edit the whole enclosing block as highlighted Markdown while other blocks stay rendered, preserving untouched source.


## 0.1.4 — 2026-11-23

1. Added one-click application of the last-used text color with a split Color button.
2. Replaced the native picker with an in-app Hex/RGB/HSL picker and visual sliders; hex accepts an optional #.
3. Persisted last-applied color and input mode across launches, independently of selection styles.
4. Preserved Visual and Source selections across color picking, with validation and cancellation protection.

## 0.1.3 — 2026-11-23

1. Fixed ineffective regeneration for .mdbbcode files without metadata: Initialize Document Properties adds Nexus settings and generates output.
2. Replaced conversion retries with Fix Source when metadata or content needs correction.
3. Preserved document text and existing-output protection during initialization; added browser and native regression coverage.

## 0.1.2 — 2026-11-23

1. Added .mdbbcode documents with YAML format, version and export target metadata.
2. Added a visual Document Properties panel with a Nexus Mods target dropdown and reserved Steam option.
3. Preserved invalid metadata while pausing export, retained unknown fields/comments and supported Save As conversion from Markdown.
4. Added active formatting indicators and selection-aware heading styles, including mixed selections and undo updates.
5. Excluded portable runtime caches from development file watching to avoid locked-file failures.

## 0.1.1 — 2026-11-22

1. Replaced SCEditor with visual Markdown editing and raw Markdown Source.
2. Added one-way companion BBCode autosave and separate output failure status.
3. Added Discord-style spoilers and HTML wrappers for centered blocks and text colors.
4. Added one-time BBCode import with loss review and original-file protection.
5. Preserved legacy recovery as explicit pending imports with a session backup.
6. Added conversion, migration and paired-save regression coverage.

## 0.1.0 — 2026-11-22

Initial portable Windows implementation using Tauri and SCEditor.

1. Added tabbed local BBCode documents and single-instance file opening.
2. Added Visual/Source switching and Copy BBCode.
3. Added Nexus formatting controls, spoiler support, and Nexus list output.
4. Added autosave, recoverable drafts, atomic file replacement, and external-change conflict handling.
5. Added source protection for unsupported or lossy visual conversions.
6. Added system light/dark appearance, file shortcuts, portable settings, and build documentation.
