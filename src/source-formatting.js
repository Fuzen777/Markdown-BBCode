// ==> Section 1 - Markdown Selection Formatting <==
export function formatMarkdownSelection(source, start, end, command, value) {
  const selected = source.slice(start, end);
  const wrappers = {
    bold: ['**', '**'], italic: ['*', '*'], strike: ['~~', '~~'],
    spoiler: selected.includes('\n') ? ['\n\n||\n\n', '\n\n||\n\n'] : ['||', '||'],
    center: ['\n\n<div style="text-align: center">\n\n', '\n\n</div>\n\n'],
    color: [`<span style="color: ${value}">`, '</span>'], code: ['\n\n```\n', '\n```\n\n'],
    link: ['[', `](${value})`], image: ['![', `](${value})`],
  };
  let replacement;
  if (wrappers[command]) replacement = wrappers[command][0] + selected + wrappers[command][1];
  else if (command === 'heading') {
    start = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const newline = source.indexOf('\n', end);
    end = newline < 0 ? source.length : newline;
    replacement = source.slice(start, end).split('\n').map(line => `${'#'.repeat(Number(value))}${Number(value) ? ' ' : ''}${line.replace(/^#{1,6}\s+/, '')}`).join('\n');
  } else if (['bullet', 'numbered', 'quote', 'task'].includes(command)) replacement = selected.split('\n').map((line, index) => `${command === 'bullet' ? '- ' : command === 'quote' ? '> ' : command === 'task' ? '- [ ] ' : `${index + 1}. `}${line}`).join('\n');
  else if (command === 'callout') replacement = '> [!note]\n' + (selected || 'Callout text').split('\n').map(line => '> ' + line).join('\n');
  else if (command === 'table') replacement = '| Column 1 | Column 2 |\n| --- | --- |\n| ' + (selected || 'Text') + ' | Text |';
  else return null;
  return { from: start, to: end, insert: replacement, start, end: start + replacement.length };
}
