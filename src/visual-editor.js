// ==> Section 1 - Visual And Source Editor Adapter <==
import { Editor } from '@tiptap/core';
import { editorExtensions, parseMarkdown, serializeMarkdown } from './markdown.js';

export class MarkdownEditor {
  constructor(visualElement, sourceElement, onChange) {
    this.visualElement = visualElement;
    this.sourceElement = sourceElement;
    this.onChange = onChange;
    this.mode = 'source';
    this.readonly = false;
    sourceElement.addEventListener('input', () => onChange());
  }
  load(source, mode) {
    this.editor?.destroy();
    this.editor = null;
    this.sourceElement.value = source;
    this.mode = mode;
    let warning = '';
    if (mode === 'visual') {
      try {
        const content = parseMarkdown(source);
        this.editor = new Editor({
          element: this.visualElement, extensions: editorExtensions, content,
          editable: !this.readonly,
          editorProps: { attributes: { 'aria-label': 'Visual Markdown Editor', role: 'textbox', spellcheck: 'true' }, handleClick: (view, position, event) => Boolean(event.target.closest('a')) },
          onUpdate: () => this.onChange(),
        });
      } catch (error) { warning = `Source view preserves this document: ${error.message}`; this.mode = 'source'; }
    }
    this.visualElement.hidden = this.mode !== 'visual';
    this.sourceElement.hidden = this.mode !== 'source';
    this.sourceElement.readOnly = this.readonly;
    return warning;
  }
  val() { return this.mode === 'source' ? this.sourceElement.value : serializeMarkdown(this.editor.getJSON()); }
  sourceMode() { return this.mode === 'source'; }
  focus() { if (this.sourceMode()) this.sourceElement.focus(); else this.editor.commands.focus(); }
  readOnly(value) { this.readonly = value; this.sourceElement.readOnly = value; this.editor?.setEditable(!value); }

  // ==> Section 2 - Formatting Commands <==
  format(command, value) {
    if (this.readonly) return;
    if (this.sourceMode()) { this.formatSource(command, value); return; }
    const chain = this.editor.chain().focus();
    const actions = {
      bold: () => chain.toggleBold(), italic: () => chain.toggleItalic(), strike: () => chain.toggleStrike(),
      bullet: () => chain.toggleBulletList(), numbered: () => chain.toggleOrderedList(), quote: () => chain.toggleBlockquote(),
      code: () => chain.toggleCodeBlock(), center: () => chain.toggleWrap('centerBlock'),
      color: () => chain.setMark('textColor', { color: value }), clear: () => chain.unsetAllMarks(),
      heading: () => Number(value) ? chain.setHeading({ level: Number(value) }) : chain.setParagraph(),
      link: () => chain.extendMarkRange('link').setLink({ href: value }), image: () => chain.setImage({ src: value }),
      spoiler: () => {
        const selection = this.editor.state.selection;
        if (this.editor.isActive('spoilerBlock')) return chain.lift('spoilerBlock');
        return !selection.empty && selection.$from.sameParent(selection.$to) ? chain.toggleMark('spoiler') : chain.wrapIn('spoilerBlock');
      },
    };
    actions[command]?.().run();
  }
  formatSource(command, value) {
    const textarea = this.sourceElement;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end);
    const wrappers = {
      bold: ['**', '**'], italic: ['*', '*'], strike: ['~~', '~~'],
      spoiler: selected.includes('\n') ? ['\n\n||\n\n', '\n\n||\n\n'] : ['||', '||'],
      center: ['\n\n<div style="text-align: center">\n\n', '\n\n</div>\n\n'],
      color: [`<span style="color: ${value}">`, '</span>'], code: ['\n\n```\n', '\n```\n\n'],
      link: ['[', `](${value})`], image: ['![', `](${value})`],
    };
    let replacement;
    if (wrappers[command]) replacement = wrappers[command][0] + selected + wrappers[command][1];
    else if (command === 'heading') replacement = `${'#'.repeat(Number(value))}${Number(value) ? ' ' : ''}${selected}`;
    else if (['bullet', 'numbered', 'quote'].includes(command)) replacement = selected.split('\n').map((line, index) => `${command === 'bullet' ? '- ' : command === 'quote' ? '> ' : `${index + 1}. `}${line}`).join('\n');
    else return;
    textarea.setRangeText(replacement, start, end, 'select');
    textarea.focus();
    this.onChange();
  }
}
