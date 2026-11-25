---
rules:
  top_level_categories:
    - Quick Wins
    - Features
    - Concerns
    - Fixes
    - Testing
    - Features In Consideration
  sub_categories: Group related tasks thematically inside each category.
  dependency_order: Order dependent items logically with prerequisite tasks first.
  quick_wins_precedence: Quick Wins takes precedence over Features, Fixes and Testing, grouped only by Features/Fixes sub-categories when helpful and contiguous component context.
---

# Markdown BBCode TODO

## BBCode Findings

*Do not remove this header or its site subheaders. Remove the examples after working on them.*

### Nexus

```
; Wrong

[size=5][b]Section 1 — Headings (H1 to H6) & Paragraphs[/b][/size]

[size=6][b]S01A — Consecutive H1 before H2[/b][/size]

[size=5][b]S01B — Consecutive H2 before H3[/b][/size]

[size=4][b]S01C — Consecutive H3 before H4[/b][/size]

[size=3][b]S01D — Consecutive H4 before H5[/b][/size]

[size=2][b]S01E — Consecutive H5 before H6[/b][/size]

[size=1][b]S01F — Consecutive H6 before Paragraph[/b][/size]

S01G — First standalone Paragraph before second Paragraph.

; Right

[size=6][b]S01A — Consecutive H1 before H2[/b][/size]
[size=5][b]S01B — Consecutive H2 before H3[/b][/size]
[size=4][b]S01C — Consecutive H3 before H4[/b][/size]
[size=3][b]S01D — Consecutive H4 before H5[/b][/size]
[size=2][b]S01E — Consecutive H5 before H6[/b][/size]
[size=1][b]S01F — Consecutive H6 before Paragraph[/b][/size]
```

## Quick Wins

## Features

- [x] Diff view, with auto-accept/sync if the new and old version don’t actually conflict (add only or remove only from lines that don’t intersect.)
- [x] Remember outline state across launches, global.
- [x] Use SVGs for Steam and Nexus (Steam.svg and NexusMods.svg added to assets.)

### Navigation

- [ ] **Quick Command Palette (`Ctrl+Shift+P` Or Dedicated Palette Shortcut)**: Add a filterable keyboard command palette to jump to any heading in the active document, switch open tabs, toggle Visual/Hybrid/Source or the live BBCode Preview pane, and run Copy or Export BBCode.

## Concerns

### Performance

- [ ] **BBCode Conversion Speed**: `documentToBBCodeWithWarnings` (and the Steam path in `steam-bbcode.js`) grows superlinearly, about 0.6 s at 50 KB and 2.4 s at 100 KB (measured in lint phase 4). It runs for Copy BBCode, Export, the live BBCode Preview and the Lint tab's BBCode warnings worker, which skips documents over 100 KB (`BBCODE_WARNINGS_MAX_KB`). Profile it, remove the superlinear hot spots, then raise or drop the 100 KB lint skip.

## Fixes

- Page mode now shows an orange outline on the edges on each side.

## Testing

## Features In Consideration

### Markdown Compatibility

- [ ] **Wiki Backlinks (`[[Page]]` And `[[Page|Alias]]`) Recognition**: Recognize wiki-style backlinks if encountered in Markdown files so they parse, render cleanly in Visual/Hybrid/Source without validation errors, and preserve raw link syntax alongside sensible Nexus BBCode export fallback or warning.
