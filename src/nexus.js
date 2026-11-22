// ==> Section 1 - Source Protection <==
const supportedTags = new Set(['b', 'i', 'u', 's', 'size', 'color', 'left', 'center', 'right', 'list', '*', 'ul', 'ol', 'li', 'url', 'img', 'quote', 'code', 'spoiler']);

export function unsupportedTags(source) {
  const withoutCode = source.replace(/\[code\][\s\S]*?\[\/code\]/gi, '');
  return [...new Set([...withoutCode.matchAll(/\[\/?([a-z][a-z\d]*|\*)(?:[=\s][^\]]*)?\]/gi)]
    .map(match => match[1].toLowerCase()).filter(tag => !supportedTags.has(tag)))];
}

export function comparableSource(source) {
  // Code block contents are literal; do not normalize tags or whitespace inside them.
  const codeBlocks = [];
  const protectedSource = source.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_, content) => {
    codeBlocks.push(content.replace(/\r\n/g, '\n'));
    return `[code]\u0000CODE${codeBlocks.length - 1}\u0000[/code]`;
  });
  return protectedSource.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '')
    .replace(/\[(\/?)([a-z]+)([^\]]*)\]/gi, (_, closing, tag, attributes) => `[${closing}${tag.toLowerCase()}${attributes}]`)
    .replace(/\[ul\]/g, '[list]').replace(/\[ol\]/g, '[list=1]').replace(/\[\/(?:ul|ol)\]/g, '[/list]')
    .replace(/\[li\]/g, '[*]').replace(/\[\/(?:li|\*)\]/g, '')
    .replace(/\n*(\[\/?(?:list|quote|code|spoiler|left|center|right)(?:=[^\]]*)?\]|\[\*\])\n*/g, '$1')
    .replace(/\n$/, '')
    // NUL-delimited placeholders cannot collide with ordinary BBCode text.
    // eslint-disable-next-line no-control-regex
    .replace(/\u0000CODE(\d+)\u0000/g, (_, index) => codeBlocks[Number(index)]);
}

export function visualSafety(source, convertedSource) {
  const unknownTags = unsupportedTags(source);
  if (unknownTags.length) return `Source view protects unsupported tags: ${unknownTags.map(tag => `[${tag}]`).join(', ')}.`;
  if (comparableSource(source) !== comparableSource(convertedSource)) return 'Source view protects formatting that the visual editor cannot reproduce faithfully.';
  return '';
}

// ==> Section 2 - Nexus Formatting Definitions <==
export function configureNexus(sceditor) {
  const definitions = sceditor.formats.bbcode;
  definitions.set('ul', { ...definitions.get('ul'), format: '[list]{0}[/list]' });
  definitions.set('ol', { ...definitions.get('ol'), format: '[list=1]{0}[/list]' });
  definitions.set('li', { ...definitions.get('li'), format: '[*]{0}' });
  definitions.set('list', {
    ...definitions.get('list'),
    html(token, attributes, content) {
      return attributes.defaultattr ? `<ol>${content}</ol>` : `<ul>${content}</ul>`;
    },
  });
  definitions.set('spoiler', {
    tags: { div: { 'data-nexus-spoiler': null } },
    isInline: false,
    format: '[spoiler]{0}[/spoiler]',
    html: '<div data-nexus-spoiler="true">{0}</div>',
  });
  sceditor.command.set('spoiler', {
    exec() { this.insert('[spoiler]', '[/spoiler]'); },
    txtExec: ['[spoiler]', '[/spoiler]'],
    tooltip: 'Spoiler',
  });
  for (const [commandName, tag] of [['bulletlist', 'list'], ['orderedlist', 'list=1']]) {
    sceditor.command.set(commandName, {
      ...sceditor.command.get(commandName),
      txtExec(caller, selected) { this.insertText(`[${tag}]\n[*]${selected.split(/\r?\n/).join('\n[*]')}\n[/list]`); },
    });
  }
}
