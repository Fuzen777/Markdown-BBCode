# BBCode Editor Features

## Documents

| Feature | Behaviour |
| --- | --- |
| Local Markdown | Default .md; .markdown and legacy .mdbbcode supported in tabs. |
| Autosave | Saves only Markdown; existing BBCode companions are untouched. |
| Optional YAML | Arbitrary frontmatter retained; legacy export target dropdown remains available. |
| On-Demand BBCode | Copy or explicit Export with loss review, replacement confirmation and revision checks. |
| One-Time Import | Reviews unsupported formatting and protects original BBCode. |
| Recovery | Open tabs, unnamed drafts, preferences and legacy imports persist beside the executable. |
| Conflict Protection | External source changes require review; failed saves prevent closing. |

## Editing

| Feature | Behaviour |
| --- | --- |
| Visual | Formatted editing with active-line slash hint, selection-aware toolbar, expanded selection bubble bar (`Turn Into`, inline styles, swatches/color clear), link hover/caret popover, code block language/copy bar, image hover pill (URL, alt text, broken state), heading dropdown, contextual table bar (with active Header Row state, grid picker, hover `+` rails, row/column drag handles and edge RMB menus) and inline callout type/fold selectors. |
| Hybrid | Whole enclosing block edits as highlighted Markdown; other blocks remain rendered; pointer drag reordering, multi-block Shift/Ctrl/marquee batch operations, active formatting state, shortcuts, smart URL paste and untouched raw source retained. |
| Source | Complete file, including YAML, remains editable with active formatting indicators, toggling, Clear, smart URL paste, line reordering (`Alt+Up`/`Down`) and cross-mode formatting shortcuts (`Ctrl+B`, `Ctrl+I`, `Ctrl+K`, `Ctrl+Shift+X`, `Ctrl+E`, `Ctrl+Alt+0`–`6`). |
| Shortcuts | Cross-mode `Ctrl` shortcuts prioritize Windows virtual keys (`VK_A`–`VK_Z`) so split `Ctrl` layouts such as `BÉPO azerty-ctrl` follow shortcut keys while keeping normal typing, `AltGr` and native clipboard actions untouched. |
| Blocks | Per-list-item and container-child handles following nesting, drag-to-nest list items and containers, Shift/Ctrl+Click and gutter marquee multi-block selection (`Move`, `Duplicate`, `Wrap`, `Delete`), hover-only gutter controls with active tint, pointer-event drag reordering, `Tab`/`Shift+Tab` list indent, `Ctrl+D` duplication, `Alt+Up`/`Down` block/line reordering, slash insertion anywhere with short aliases (Divider, Toggle, Spoiler, Center, Image) and click-below-last-block; Hybrid insertion with outside-click dismissal and boundary-aware block actions. |
| Preview, Outline & Search | Resizable toggleable live Nexus BBCode split preview pane with bidirectional scroll sync, right-side three-state Document Outline (`Off` / `Float` / `Dock`), cross-mode Find & Replace (`Ctrl+F` / `Ctrl+H`), file drag-and-drop and live word/character counts. |
| Markdown Elements | Headings, inline styles, links, web images, lists, tasks, tables, quotes and code. |
| Callouts | Obsidian types, custom editable titles, nesting and optional folding. |
| Extra Formatting | Discord-style spoilers, HTML center and color wrappers. |
| Color Picker | One-click remembered color, optional #, Hex/RGB/HSL and sliders; settings persist across launches. |
| Appearance | System light/dark style and responsive layout. |

## Limits

Steam conversion, publishing, image uploads and managed local attachments are deferred. BBCode export warns when reducing tasks, tables or callouts. Unsupported syntax remains editable in Source/Hybrid and may block conversion. Visual edits normalize Markdown; mode/tab changes reset undo. Adjacent compatible lists follow Markdown merging rules. Final Nexus rendering needs a site check.

## Hybrid Spacing And Icon Controls

Real top-level blank lines are individual editable blocks; content blocks have no extra trailing editor rows. Gutter actions do not add vertical space. Blank rows can be edited, duplicated, deleted or moved, with undo. Internal container spacing is preserved.

File and formatting actions use locally bundled Material Symbols Rounded icons with hover and keyboard-focus tooltips. Icons work offline, preserve active styles and retain accessible names. Modes, dropdowns and confirmation actions remain text-labelled.

Block-type and block-action entries in Turn Into, Block Actions, Insert and slash menus show matching icons alongside their text, including distinct Heading 1, 2 and 3 symbols.
