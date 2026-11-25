# Error Codes

> [!abstract]
> Stable codes the app shows when it cannot do something with a document. Codes are never renumbered or reused; add new ones at the end of their table. `src/editor-errors.js` owns the editor fallback codes.

## Editor Fallback (MBB-VISUAL / MBB-HYBRID)

When a document cannot open in Visual (`MBB-VISUAL-…`) or Hybrid (`MBB-HYBRID-…`), the editor shows it in Source instead, with an error notice such as:

> [!quote]
> Visual mode can't open this document (MBB-VISUAL-002: unsupported or unfinished HTML at line 5). Source view keeps it unchanged.

The source is untouched and saving keeps working. Line numbers count from the top of the file, front matter included, and are shown when the parser can place the problem.

| Number | Reason | Typical cause |
| --- | --- | --- |
| 001 | Incompatible inline formatting | Two inline marks the schema cannot combine on the same text (the notice names them, e.g. `bold + code`). Bold, italic, strike, link, spoiler and color now combine with inline code, so this should not occur for ordinary Markdown. |
| 002 | Unsupported or unfinished HTML | Block HTML (an HTML block on its own lines) other than the color span and centered div wrappers, or an unclosed wrapper. Inline tags inside a line, such as `Started <name>` or `<kbd>`, open as literal text |
| 003 | Reference link definitions | `[label]: https://…` definitions, which are kept in Source or Hybrid |
| 004 | Invalid YAML front matter | A front matter block that is not valid YAML or not a mapping |
| 005 | Unsupported document structure | Any other content the editor schema rejects |
| 099 | Unexpected parse error | Anything unclassified; please report it with the document |
