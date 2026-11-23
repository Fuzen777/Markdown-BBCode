# BBCode Editor Features

## Documents

| Feature | Behaviour |
| --- | --- |
| Local Markdown | Default .md; .markdown, .mdbbcode and auto-detected non-BBCode .txt files supported directly in tabs. |
| Autosave | Saves only Markdown; existing BBCode companions are untouched. |
| Optional YAML | Arbitrary frontmatter retained; legacy export target dropdown remains available. |
| On-Demand BBCode | Copy or explicit Export with single-newline Nexus block spacing (preserving extra intentional blank lines), loss review, replacement confirmation and revision checks. |
| One-Time Import | Auto-detects BBCode tags in opened `.txt` files (alongside `.bbcode` files), reviews unsupported formatting and protects originals. |
| Recovery | Open tabs, unnamed drafts, preferences and legacy imports persist beside the executable. |
| Conflict Protection | External source changes require review; failed saves prevent closing. |

## Editing

| Feature | Behaviour |
| --- | --- |
| Visual | Formatted editing with active-line slash hint, selection-aware toolbar, expanded selection bubble bar (`Turn Into`, inline styles, swatches/color clear), link hover/caret popover, code block language/copy bar, image hover pill (URL, alt text, broken state), heading dropdown, contextual table bar (with active Header Row state, grid picker, hover `+` rails, row/column drag handles and edge RMB menus) and inline callout type/fold selectors. |
| Hybrid | Enclosing-block Markdown editing with Obsidian-style line/item Live Preview (raw syntax on cursor lines and live bullets, interactive checkboxes, callout badges/colors, dividers and inline formatting on sibling lines), incremental sibling DOM preservation, click-to-cursor placement, wrapped and cross-block vertical navigation, boundary blank-line Backspace/Delete, direct task toggling, link hover/`Ctrl+Click` popovers, smart list/quote Enter continuation, `Tab`/`Shift+Tab` indenting, live-filtered `/` menu, `Turn Into` submenu, multi-block `Wrap In`/`Delete`, shared selection bubble bar, pointer drag reordering and untouched raw source retention. |
| Source | Complete file, including YAML, remains editable with active formatting indicators, toggling, Clear, smart URL paste, line reordering (`Alt+Up`/`Down`) and cross-mode formatting shortcuts (`Ctrl+B`, `Ctrl+I`, `Ctrl+K`, `Ctrl+Shift+X`, `Ctrl+E`, `Ctrl+Alt+0`–`6`). |
| Shortcuts | Cross-mode `Ctrl` shortcuts prioritize Windows virtual keys (`VK_A`–`VK_Z`) so split `Ctrl` layouts such as `BÉPO azerty-ctrl` follow shortcut keys while keeping normal typing, `AltGr` and native clipboard actions untouched. |
| Blocks | Vertically centered gutter drag handles and `+` controls on horizontal rules (`---`) across Visual and Hybrid, per-list-item and container-child handles following nesting, drag-to-nest list items and containers, Shift/Ctrl+Click and gutter marquee multi-block selection (`Move`, `Duplicate`, `Wrap`, `Delete`), hover-only gutter controls with active tint, pointer-event drag reordering, `Tab`/`Shift+Tab` list indent, `Ctrl+D` duplication, `Alt+Up`/`Down` block/line reordering, live-filtered slash insertion anywhere with short aliases (Divider, Toggle, Spoiler, Center, Image) and click-below-last-block; Hybrid `Turn Into` submenu, outside-click dismissal and boundary-aware block actions. |
| Preview, Outline & Search | Resizable toggleable live Nexus BBCode split preview pane with bidirectional scroll sync, right-side three-state Document Outline (`Off` / `Float` / `Dock`), resizable collapsible left-side Folder Browser (`Ctrl+Shift+E`, open by default with auto-follow, breadcrumbs, expandable monorepo tree, recursive filter, Pinned/Recent folders, `.md`/`.markdown`/`.mdbbcode`/`.txt`/`.bbcode` (`Import`) filtering, hidden asset folder `All` toggle, `+ New File`, inline `Rename`, `Reveal In Explorer`, `Copy Path` and folder drag-and-drop), cross-mode Find & Replace (`Ctrl+F` / `Ctrl+H`), file/folder drag-and-drop and live word/character counts. |
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
