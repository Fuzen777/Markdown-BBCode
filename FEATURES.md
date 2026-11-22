# BBCode Editor Features

## Documents

| Feature | Behaviour |
| --- | --- |
| Local Documents | Create `.mdbbcode` documents; also open UTF-8 `.md` and `.markdown` files in tabs. |
| Paired Autosave | Save Markdown, then generate a same-stem `.bbcode` companion. |
| Independent Output Status | Markdown saves even when conversion or BBCode writing fails. |
| Copy BBCode | Convert the current Markdown and copy the result. |
| One-Time Import | Import `.bbcode` or `.txt`, review formatting losses, and save under a new basename. |
| Conflict Protection | Revision-checked source and output writes; external changes require review. |
| Recovery | Recover open tabs, unnamed drafts and pending legacy BBCode imports. |
| Portable Operation | Single-instance Windows app with settings beside the executable. |

## Editing

Selection-aware formatting buttons and a paragraph dropdown that follows headings, mixed selections and undo. Visual Markdown and Source modes with headings, bold, italic, strikethrough, lists, quotes, code, links and web images. Toolbar buttons apply inline or block spoilers, centered blocks and hexadecimal text colors. Spoilers display expanded. System light/dark appearance and standard file shortcuts are supported.

## Limits

No Steam profile, publishing integration, image uploads or managed local attachments. Tables, task lists and arbitrary HTML remain source-only and block export. Visual edits normalize Markdown; tab/mode changes reset visual undo. Generated BBCode is one-way output. Final Nexus rendering needs a site check.

## Document Properties

Visual Target dropdown synchronized with YAML in Source. Nexus is supported; Steam remains unavailable. Invalid YAML saves without generating output. Unknown properties and comments are retained. Save As converts existing Markdown to .mdbbcode with metadata; imports use the new extension too.


## Output Recovery

Missing YAML headers offer Initialize Document Properties, which adds Nexus metadata, saves the source and generates BBCode. The body is preserved. Invalid metadata or unsupported content offers Fix Source instead of an ineffective retry. Existing BBCode still requires reviewed replacement.


## Color Picker

The Color control is split: click the swatch to apply the last-used color immediately, or the arrow to open the in-app picker. Hex, RGB and HSL input modes and hue/saturation/lightness sliders are supported. Hex accepts 3 or 6 digits with an optional #. The last-applied color and selected input mode persist across launches in portable-data; changing mode is remembered even when canceling. Selecting colored text highlights the control without replacing the remembered color. Cancel/Escape leaves document content unchanged. Visual and Source selections are preserved while choosing a color.
