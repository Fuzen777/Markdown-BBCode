// ==> Section 1 - Inline Code Mark Combinations And Coded Fallback Errors <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMarkdown, serializeMarkdown, markdownToBBCodeWithWarnings, editorExtensions } from '../src/markdown.js';
import { readDocumentSource } from '../src/document-format.js';
import { describeEditorFallback } from '../src/editor-errors.js';
import { getSchema } from '@tiptap/core';

const combinations = [
  '**`x`**',
  '*`x`*',
  '~~`x`~~',
  '***`x`***',
  '[`x`](https://example.com)',
  '||`x`||',
  '<span style="color: #ff0000">`x`</span>',
  '**bold `code` more**',
  '- [ ] **Quick Command Palette (`Ctrl+Shift+P` Or Dedicated Palette Shortcut)**: Add a palette.',
];

test('inline code coexists with bold, italic, strike, link, spoiler and color and round-trips byte-identically', () => {
  for (const source of combinations) {
    const model = parseMarkdown(source);
    assert.equal(serializeMarkdown(model).trim(), source, source);
    getSchema(editorExtensions).nodeFromJSON(model).check();
  }
  const marks = parseMarkdown('**`x`**').content[0].content[0].marks.map(mark => mark.type);
  assert.deepEqual(marks, ['bold', 'code'], 'code sorts innermost');
});

test('BBCode converters nest code innermost for combined marks', () => {
  assert.equal(markdownToBBCodeWithWarnings('**`x`**', 'nexus').bbcode, '[b][code]x[/code][/b]');
  assert.equal(markdownToBBCodeWithWarnings('*`x`*', 'steam').bbcode, '[i][code]x[/code][/i]');
  assert.equal(markdownToBBCodeWithWarnings('[`x`](https://example.com)', 'nexus').bbcode, '[url=https://example.com][code]x[/code][/url]');
  assert.equal(markdownToBBCodeWithWarnings('||`x`||', 'steam').bbcode, '[spoiler][code]x[/code][/spoiler]');
});

test('the repository TODO.md now parses for Visual mode', () => {
  const { body } = readDocumentSource(readFileSync(new URL('../TODO.md', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => parseMarkdown(body));
});

test('parse failures carry a line and map to stable MBB codes', () => {
  const html = (() => { try { parseMarkdown('# T\n\nText\n\n<script>x</script>\n'); } catch (error) { return error; } })();
  assert.equal(html.line, 5);
  const described = describeEditorFallback(html, 'visual', 3);
  assert.equal(described.code, 'MBB-VISUAL-002');
  assert.equal(described.line, 8);
  assert.equal(described.message, "Visual mode can't open this document (MBB-VISUAL-002: unsupported or unfinished HTML at line 8). Source view keeps it unchanged.");
  const reference = (() => { try { parseMarkdown('Text [a][r]\n\n[r]: https://x.y\n'); } catch (error) { return error; } })();
  assert.equal(describeEditorFallback(reference, 'visual').code, 'MBB-VISUAL-003');
  const marks = Object.assign(new Error('Invalid collection of marks for node text: bold,code'), { line: 2 });
  assert.equal(describeEditorFallback(marks, 'visual').message, "Visual mode can't open this document (MBB-VISUAL-001: incompatible inline formatting at line 2: bold + code). Source view keeps it unchanged.");
  assert.equal(describeEditorFallback(new Error('Invalid YAML: bad'), 'hybrid').code, 'MBB-HYBRID-004');
  assert.equal(describeEditorFallback(new Error('Something else'), 'visual').code, 'MBB-VISUAL-099');
});
