// ==> Section 1 - Markdown Conversion Tests <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, serializeMarkdown, markdownToBBCode } from '../src/markdown.js';
import { importBBCode } from '../src/bbcode-import.js';

const fixtures = [
  '# Heading\n\n**Bold** and *italic* and ~~struck~~.',
  'Before ||**hidden**|| after.',
  '||\n\nFirst paragraph\n\nSecond paragraph\n\n||',
  '<div style="text-align: center">\n\n# Title\n\n- One\n- Two\n\n</div>',
  '<span style="color: #e6a050">Coloured **text**</span>',
  '<div style="text-align: center">\n\n||\n\n<span style="color: #abc">Hidden</span>\n\nMore text\n\n||\n\n</div>',
  '- Parent\n  - Child\n- Second\n\n1. First\n2. Second',
  '> Quote\n>\n> Another paragraph',
  '[Link](https://example.com) ![Image](https://example.com/image.png)',
  '```js\nconst text = "|| <div> [b] ";\n```',
  'Literal \\|\\|pipes\\|\\| and `||code||` and é 🐈',
];
for (const fixture of fixtures) {
  test(`round trip: ${fixture.slice(0, 60)}`, () => {
    const expected = markdownToBBCode(fixture);
    assert.equal(markdownToBBCode(serializeMarkdown(parseMarkdown(fixture))), expected);
  });
}
test('multi-paragraph spoilers keep paragraph boundaries', () => {
  assert.equal(markdownToBBCode(fixtures[2]), '[spoiler]First paragraph\n\nSecond paragraph[/spoiler]');
});
test('unrecognized HTML and tables fail instead of silently dropping content', () => {
  assert.throws(() => parseMarkdown('<script>alert(1)</script>'), /Unsupported/);
  assert.throws(() => parseMarkdown('<div style="text-align: right">text</div>'), /Unsupported/);
  assert.throws(() => parseMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |'), /tables/);
  assert.throws(() => markdownToBBCode('[bad](javascript:alert)'), /HTTP/);
});
test('import converts supported formats and reports losses', () => {
  const imported = importBBCode('[center][b]Title[/b][/center]\n[spoiler]Secret[/spoiler]\n[color=#f00]Red[/color]\n[size=4]Sized[/size][u]Underlined[/u]');
  assert.match(imported.markdown, /text-align: center/);
  assert.match(imported.markdown, /\|\|Secret\|\|/);
  assert.match(imported.markdown, /color: #ff0000/);
  assert.match(imported.warnings.join(' '), /size/);
  assert.match(imported.warnings.join(' '), /\[u\]/);
  assert.match(markdownToBBCode(imported.markdown), /SizedUnderlined/);
});
test('import preserves literal Markdown, code, nested lists, and standalone images', () => {
  const imported = importBBCode('Literal *stars* and ||pipes||\n[list][*]One[list][*]Nested[/list][*]Two[/list]\n[code][unknown]literal[/unknown][/code]\n[img=https://example.com/image.png]');
  const bbcode = markdownToBBCode(imported.markdown);
  assert.match(bbcode, /Literal \*stars\* and \|\|pipes\|\|/);
  assert.match(bbcode, /\[code\]\[unknown\]literal\[\/unknown\]\[\/code\]/);
  assert.match(bbcode, /\[img\]https:\/\/example.com\/image.png\[\/img\]/);
  assert.match(bbcode, /Nested/);
});
test('import distributes colours over paragraphs without losing them', () => {
  const imported = importBBCode('[color=#abcdef]One\n\nTwo[/color]');
  assert.deepEqual(imported.warnings, []);
  assert.equal(markdownToBBCode(imported.markdown), '[color=#abcdef]One[/color]\n\n[color=#abcdef]Two[/color]');
});

test('inline spoiler endings do not prematurely close a multiline spoiler', () => {
  const source = '||\n\nBefore ||inner||\n\nAfter\n\n||';
  const converted = markdownToBBCode(source);
  assert.match(converted, /After\s*\[\/spoiler\]$/);
  assert.deepEqual(parseMarkdown(serializeMarkdown(parseMarkdown(source))), parseMarkdown(source));
});
