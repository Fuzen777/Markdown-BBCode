// ==> Section 1 - Visual And Source Editor Adapter <==
import { readDocumentSource, isMdbbcode, withDocumentMetadata } from './document-format.js';
import { Editor } from '@tiptap/core';
import { editorExtensions, parseMarkdown, serializeMarkdown } from './markdown.js';

export class MarkdownEditor {
  constructor(visualElement, sourceElement, onChange, onSelectionChange = () => {}) {
    this.visualElement = visualElement;
    this.sourceElement = sourceElement;
    this.onChange = onChange;
    this.onSelectionChange = onSelectionChange;
    this.mode = 'source';
    this.readonly = false;
    sourceElement.addEventListener('input', () => onChange());
  }
  load(source, mode, path) {
    this.path = path;
    this.visualChanged = false;
    this.documentSource = null;
    this.editor?.destroy();
    this.editor = null;
    this.sourceElement.value = source;
    this.mode = mode;
    let warning = '';
    if (mode === 'visual') {
      try {
        this.documentSource = readDocumentSource(source, isMdbbcode(path));
        const content = parseMarkdown(this.documentSource.body);
        this.editor = new Editor({
          element: this.visualElement, extensions: editorExtensions, content,
          editable: !this.readonly,
          editorProps: { attributes: { 'aria-label': 'Visual Markdown Editor', role: 'textbox', spellcheck: 'true' }, handleClick: (view, position, event) => Boolean(event.target.closest('a')) },
          onUpdate: () => { this.visualChanged = true; this.onChange(); },
          onSelectionUpdate: () => this.onSelectionChange(),
          onTransaction: () => this.onSelectionChange(),
        });
      } catch (error) { warning = `Source view preserves this document: ${error.message}`; this.mode = 'source'; }
    }
    this.visualElement.hidden = this.mode !== 'visual';
    this.sourceElement.hidden = this.mode !== 'source';
    this.sourceElement.readOnly = this.readonly;
    return warning;
  }
  val() { return this.mode === 'source' ? this.sourceElement.value : this.documentSource.prefix + (this.visualChanged ? serializeMarkdown(this.editor.getJSON()) : this.documentSource.body); }
  setTarget(target) {
    if (this.readonly || this.sourceMode() || target !== 'nexus') return;
    const source = withDocumentMetadata(this.val(), target);
    this.load(source, 'visual', this.path);
    this.onChange();
  }
  formattingState() {
    if (this.sourceMode() || !this.editor) return null;
    const editor = this.editor;
    const active = name => editor.isActive(name);
    const paragraphStyles = new Set();
    const selection = editor.state.selection;
    const recordStyle = node => {
      if (node.isTextblock) paragraphStyles.add(node.type.name === 'heading' ? String(node.attrs.level) : node.type.name === 'paragraph' ? '0' : 'other');
    };
    if (selection.empty) recordStyle(selection.$from.parent);
    else editor.state.doc.nodesBetween(selection.from, selection.to, recordStyle);
    return {
      heading: paragraphStyles.size === 1 ? [...paragraphStyles][0] : 'mixed',
      bold: active('bold'), italic: active('italic'), strike: active('strike'),
      bullet: active('bulletList'), numbered: active('orderedList'), quote: active('blockquote'),
      code: active('codeBlock') || active('code'), link: active('link'), image: active('image'),
      spoiler: active('spoiler') || active('spoilerBlock'), center: active('centerBlock'),
      color: active('textColor') ? editor.getAttributes('textColor').color : null,
    };
  }
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
