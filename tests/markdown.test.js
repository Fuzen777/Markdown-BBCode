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

test('Nexus BBCode keeps blank lines between titles and paragraphs and omits them around lists', () => {
  const standard = markdownToBBCodeWithWarnings('# Heading\n\nPara 1\n\nPara 2\n\n## Section\n\n- Item A\n- Item B\n\nAfter list\n\n1. First\n\n- [ ] Task\n\nClosing');
  assert.equal(
    standard.bbcode,
    [
      '[size=6][b]Heading[/b][/size]',
      '',
      'Para 1',
      '',
      'Para 2',
      '',
      '[size=5][b]Section[/b][/size]',
      '[list]',
      '[*]Item A',
      '[*]Item B',
      '[/list]',
      'After list',
      '[list=1]',
      '[*]First',
      '[/list]',
      '[list]',
      '[*][ ] Task',
      '[/list]',
      'Closing',
    ].join('\n'),
  );
  assert.deepEqual(standard.blockOffsets, [
    { startLine: 0, endLine: 1 },
    { startLine: 2, endLine: 3 },
    { startLine: 4, endLine: 5 },
    { startLine: 6, endLine: 7 },
    { startLine: 7, endLine: 11 },
    { startLine: 11, endLine: 12 },
    { startLine: 12, endLine: 15 },
    { startLine: 15, endLine: 18 },
    { startLine: 18, endLine: 19 },
  ]);
  assert.equal(standard.totalLines, 19);

  const spaced = markdownToBBCodeWithWarnings('# Heading\n\n\nPara 1\n\n\n\nPara 2\n\n\n- List Item');
  assert.equal(
    spaced.bbcode,
    '[size=6][b]Heading[/b][/size]\n\n\nPara 1\n\n\n\nPara 2\n\n[list]\n[*]List Item\n[/list]',
  );
  assert.deepEqual(spaced.blockOffsets[0], { startLine: 0, endLine: 1 });
  assert.deepEqual(spaced.blockOffsets[1], { startLine: 3, endLine: 4 });
  assert.deepEqual(spaced.blockOffsets[2], { startLine: 5, endLine: 6 });
  assert.deepEqual(spaced.blockOffsets[3], { startLine: 7, endLine: 8 });
  assert.deepEqual(spaced.blockOffsets.at(-1), { startLine: 9, endLine: 12 });
  assert.equal(spaced.totalLines, 12);

  assert.equal(
    markdownToBBCode('> [!note] Info\n> Line one\n>\n> Line two'),
    '[quote][b]Info[/b]\n\nLine one\n\nLine two[/quote]',
  );
  assert.equal(
    markdownToBBCode('> [!note] Items\n> - First\n> - Second'),
    '[quote][b]Items[/b]\n[list]\n[*]First\n[*]Second\n[/list][/quote]',
  );
});

// ==> Section 3 - Steam BBCode Conversion And Import <==
test('Steam BBCode maps headings, inline styles, code glue, embeds, flattened lists, quotes, tables and hr', () => {
  const headings = markdownToBBCodeWithWarnings('# One\n\n## Two\n\n### Three\n\n#### Four', 'steam');
  assert.equal(headings.bbcode, '[h1]One[/h1]\n[h2]Two[/h2]\n[h3]Three[/h3]\n[h3]Four[/h3]');
  assert.ok(headings.warnings.includes('Headings below level 3 were written as [h3].'));

  const inline = markdownToBBCode('**bold** *italic* ~~gone~~ ||hidden **name**|| [Steam](https://store.steampowered.com/app/323190/)', 'steam');
  assert.equal(inline, '[b]bold[/b] [i]italic[/i] [strike]gone[/strike] [spoiler]hidden [b]name[/b][/spoiler] [url=https://store.steampowered.com/app/323190/]Steam[/url]');

  const codeResult = markdownToBBCodeWithWarnings('Use `hp` here.\n\n```\n||not a spoiler||\n```\n\nNext line.', 'steam');
  assert.equal(codeResult.bbcode, 'Use [code]hp[/code]here.\n\n[code]||not a spoiler||[/code]Next line.');
  assert.deepEqual(codeResult.blockOffsets, [
    { startLine: 0, endLine: 1 },
    { startLine: 2, endLine: 3 },
    { startLine: 2, endLine: 3 },
  ]);
  assert.equal(codeResult.totalLines, 3);

  assert.equal(markdownToBBCode('`path`\n\nNext', 'steam'), '[code]path[/code]Next');

  assert.equal(markdownToBBCode('https://www.youtube.com/watch?v=tax4e4hBBZc', 'steam'), 'https://www.youtube.com/watch?v=tax4e4hBBZc');
  assert.equal(markdownToBBCode('https://store.steampowered.com/app/323190/', 'steam'), 'https://store.steampowered.com/app/323190/');
  assert.equal(markdownToBBCode('https://steamcommunity.com/sharedfiles/filedetails/?id=157328145', 'steam'), 'https://steamcommunity.com/sharedfiles/filedetails/?id=157328145');
  assert.equal(markdownToBBCode('![Trailer](https://youtu.be/tax4e4hBBZc)', 'steam'), 'https://youtu.be/tax4e4hBBZc');
  assert.equal(markdownToBBCode('![Map](https://example.com/map.png)', 'steam'), '[url=https://example.com/map.png]Map[/url]');

  const structure = markdownToBBCode('# Title\n\nIntro\n\n- One\n  - Nested\n    - Deeper\n\nAfter', 'steam');
  assert.equal(structure, '[h1]Title[/h1]\nIntro\n[list][*]One[*]› Nested[*]› › Deeper[/list]\nAfter');

  const ordered = markdownToBBCode('Before\n\n1. First\n   1. Inner\n\nAfter', 'steam');
  assert.equal(ordered, 'Before\n[olist][*]First[*]› Inner[/olist]\nAfter');

  const blocks = markdownToBBCodeWithWarnings('> Quoted line\n\n| Name | Age |\n| --- | --- |\n| John | 65 |\n\n---', 'steam');
  assert.equal(blocks.bbcode, '[quote]Quoted line[/quote]\n\n[table][tr][th]Name[/th][th]Age[/th][/tr][tr][td]John[/td][td]65[/td][/tr][/table]\n\n[hr][/hr]');
  assert.deepEqual(blocks.warnings, []);
});

test('Steam BBCode handles escaping, warnings, callouts, tasks, spoilers and intentional blank lines', () => {
  const escaped = markdownToBBCodeWithWarnings('Use [b]literally[/b], note [^1], and damage $2x+1$.', 'steam');
  assert.equal(escaped.bbcode, 'Use [noparse][[/noparse]b]literally[noparse][[/noparse]/b], note [noparse][[/noparse]^1], and damage $2x+1$.');
  assert.ok(escaped.warnings.includes('Footnotes have no Steam tag; the marker was kept as text.'));
  assert.ok(escaped.warnings.includes('Math has no Steam tag; the expression was kept as text.'));

  const extended = markdownToBBCodeWithWarnings(
    '<div style="text-align: center">\n\n<span style="color: #e6a050">Colored</span>\n\n</div>\n\n- [x] Done\n\n> [!warning]- Caution\n> Backup first\n\n||\n\nSpoiler A\n\nSpoiler B\n\n||',
    'steam',
  );
  assert.equal(
    extended.bbcode,
    'Colored\n[list][*][x] Done[/list]\n[quote][spoiler][b]Caution[/b]\nBackup first[/spoiler][/quote]\n\n[spoiler]Spoiler A\n\nSpoiler B[/spoiler]',
  );
  assert.ok(extended.warnings.includes('Centered alignment has no Steam BBCode tag; alignment was removed.'));
  assert.ok(extended.warnings.includes('Text color has no Steam BBCode tag; color formatting was removed.'));
  assert.ok(extended.warnings.includes('Task checkboxes are exported as text, not interactive controls.'));
  assert.ok(extended.warnings.includes('Callouts are exported as titled quotes; collapsible callouts use spoilers.'));

  const extra = markdownToBBCodeWithWarnings('# Title\n\n\nIntro\n\n\n- Item', 'steam');
  assert.equal(extra.bbcode, '[h1]Title[/h1]\n\nIntro\n\n[list][*]Item[/list]');
  assert.equal(extra.totalLines, 5);
});

test('importBBCode imports Steam BBCode headings, strike, tables, olist, hr, noparse and glued inline code', () => {
  const steamSource = [
    '[h1]Title[/h1]',
    '',
    'A [b]bold[/b] [strike]struck[/strike] [noparse][[/noparse]b]literal.',
    '',
    '[list][*]One[*]› Nested[*]› › Deeper[/list]',
    '',
    '[olist][*]First[*]› Inner[*]Second[/olist]',
    '',
    '[list][*][b]Custom[/b] — place a file in [code]Documents/ClearTypeTerraria/[/code]If several files are present.[/list]',
    '',
    '[table][tr][th]Name[/th][th]Age[/th][/tr][tr][td]John[/td][td]65[/td][/tr][/table]',
    '',
    '[hr][/hr]',
  ].join('\n');
  const imported = importBBCode(steamSource);
  assert.deepEqual(imported.warnings, []);
  assert.doesNotMatch(imported.markdown, /&nbsp;/);
  assert.match(imported.markdown, /^# Title/m);
  assert.match(imported.markdown, /\*\*bold\*\* ~~struck~~/);
  assert.match(imported.markdown, /\\\[b\\\]literal\./);
  assert.match(imported.markdown, /- One\n {2}- Nested\n {4}- Deeper/);
  assert.match(imported.markdown, /1\. First\n {3}1\. Inner\n2\. Second/);
  assert.match(imported.markdown, /`Documents\/ClearTypeTerraria\/` If several files are present\./);
  assert.match(imported.markdown, /\| Name \| Age \|\n\| ---- \| --- \|\n\| John \| 65 {2}\|/);
  assert.match(imported.markdown, /^---$/m);
  assert.match(markdownToBBCode(imported.markdown, 'steam'), /\[noparse\]\[\[\/noparse\]b\]literal\./);
});
