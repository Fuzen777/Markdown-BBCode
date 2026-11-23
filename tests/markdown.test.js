// ==> Section 1 - Markdown Conversion Tests <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, serializeMarkdown, markdownToBBCode, markdownToBBCodeWithWarnings, segmentMarkdown, isHttpUrl } from '../src/markdown.js';
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
test('unrecognized HTML fails instead of silently dropping content', () => {
  assert.throws(() => parseMarkdown('<script>alert(1)</script>'), /Unsupported/);
  assert.throws(() => parseMarkdown('<div style="text-align: right">text</div>'), /Unsupported/);
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

// ==> Section 2 - Markdown-First Blocks <==
test('nested callouts preserve type, title and collapse defaults', () => {
  const source = '> [!warning]- Before installing\n> **Back up** first.\n>\n> > [!custom-type]+ More\n> > Nested details\n\nOutside';
  const documentModel = parseMarkdown(source);
  assert.equal(documentModel.content[0].type, 'callout');
  assert.deepEqual({ ...documentModel.content[0].attrs }, { type: 'warning', title: 'Before installing', fold: '-' });
  assert.equal(documentModel.content[0].content[1].attrs.type, 'custom-type');
  assert.deepEqual(parseMarkdown(serializeMarkdown(documentModel)), documentModel);
  const exported = markdownToBBCodeWithWarnings(source);
  assert.equal(exported.warnings.length, 1);
  assert.match(exported.bbcode, /\[quote\]\[spoiler\]\[b\]Before installing/);
  assert.match(exported.bbcode, /Outside$/);
});

test('title-only and plain callouts do not invent content or collapse markers', () => {
  for (const source of ['> [!note]', '> [!tip] Custom title', '> [!abstract]\n> Body']) {
    const documentModel = parseMarkdown(source);
    assert.equal(documentModel.content[0].attrs.fold, null);
    assert.deepEqual(parseMarkdown(serializeMarkdown(documentModel)), documentModel);
  }
});

test('task lists preserve checkbox state, nested bullets and multiple paragraphs', () => {
  const source = '- [x] Done\n- [ ] Pending\n  - [ ] Child\n  - Plain child\n\n  Second paragraph\n\n- [x] Last';
  const documentModel = parseMarkdown(source);
  assert.equal(documentModel.content[0].type, 'taskList');
  assert.deepEqual(parseMarkdown(serializeMarkdown(documentModel)), documentModel);
  const exported = markdownToBBCodeWithWarnings(source);
  assert.match(exported.bbcode, /\[x\] Done/);
  assert.match(exported.bbcode, /\[ \] Pending/);
  assert.match(exported.bbcode, /Second paragraph/);
  assert.equal(exported.warnings.length, 1);
});

test('GFM tables preserve aligned columns and inline content with export warnings', () => {
  const source = '| Name | Value |\n| :--- | ---: |\n| **One** | `a\\|b` |\n| Two | [Link](https://example.com) |';
  const documentModel = parseMarkdown(source);
  assert.equal(documentModel.content[0].type, 'table');
  assert.equal(documentModel.content[0].content[0].content[1].attrs.align, 'right');
  assert.deepEqual(parseMarkdown(serializeMarkdown(documentModel)), documentModel);
  const exported = markdownToBBCodeWithWarnings(source);
  assert.match(exported.bbcode, /\[b\]Name\[\/b\] \| \[b\]Value/);
  assert.equal(exported.warnings.length, 1);
  assert.equal(exported.blockOffsets.length, 1);
  assert.equal(exported.blockOffsets[0].startLine, 0);
  assert.equal(exported.totalLines, 3);
});

test('unsupported markup inside task items and table cells is never silently dropped', () => {
  assert.throws(() => parseMarkdown('- [ ] <script>Bad</script>'), /Unsupported/);
  assert.throws(() => parseMarkdown('| A |\n| --- |\n| <script>Bad</script> |'), /Unsupported/);
  assert.throws(() => parseMarkdown('[reference]: https://example.com'), /Reference/);
});

test('source blocks retain every byte, CRLF separators and whole enclosing containers', () => {
  const source = '\r\n# Heading\r\n\r\n- Parent\r\n  - Child\r\n- Other\r\n\r\n> [!note]- Title\r\n> Paragraph\r\n>\r\n> > [!tip]\r\n> > Nested\r\n\r\n```md\r\n## Literal\r\n```\r\n';
  const blocks = segmentMarkdown(source);
  assert.equal(blocks.length, 8);
  assert.equal(blocks.map(block => block.raw).join(''), source);
  assert.deepEqual(blocks.map(block => block.type), ['space', 'heading', 'space', 'list', 'space', 'callout', 'space', 'code']);
  for (const block of blocks) assert.equal(source.slice(block.start, block.end), block.raw);
  assert.equal(segmentMarkdown('- [ ] First\n\n  Details\n\n- [x] Second').length, 1);
});


test('each top-level blank line has an exact independent source span', () => {
  for (const source of ['First\n\nSecond', '\n\n# Heading\n\n\nTail\n', '  \r\nText\r\n \r\n\t\r\nEnd', '# One\n## Two\n', '\n\n']) {
    const blocks = segmentMarkdown(source);
    assert.equal(blocks.map(block => block.raw).join(''), source);
    for (const block of blocks) {
      assert.equal(source.slice(block.start, block.end), block.raw);
      if (block.type === 'space') assert.match(block.raw, /^[ \t]*(?:\r?\n)?$/);
      else assert.doesNotMatch(block.raw, /\n[ \t]*\r?\n$/);
    }
  }
  assert.deepEqual(segmentMarkdown('A\n\nB').map(block => block.raw), ['A\n', '\n', 'B']);
  assert.equal(segmentMarkdown('\x60\x60\x60\nA\n\nB\n\x60\x60\x60').length, 1);
});

test('isHttpUrl validates safe external URLs and divider, image alt, code language round-trip', () => {
  assert.equal(isHttpUrl('https://nexusmods.com/mods/1'), true);
  assert.equal(isHttpUrl('http://example.com'), true);
  assert.equal(isHttpUrl('javascript:alert(1)'), false);
  assert.equal(isHttpUrl('https://bad url.com'), false);

  const source = '```lua\nprint("hi")\n```\n\n---\n\n![Banner Alt](https://example.com/banner.png)';
  const roundTripped = serializeMarkdown(parseMarkdown(source));
  assert.match(roundTripped, /^```lua/m);
  assert.match(roundTripped, /^---$/m);
  assert.match(roundTripped, /!\[Banner Alt\]\(https:\/\/example\.com\/banner\.png\)/);
});
