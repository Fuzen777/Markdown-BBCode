// ==> Section 1 - Visual And Source Editor Adapter <==
import { readDocumentSource, isMdbbcode, withDocumentMetadata } from './document-format.js';
import { HybridEditor } from './hybrid-editor.js';
import { BlockControls } from './block-controls.js';
import { TableEdgeControls } from './table-controls.js';
import { BubbleMenu } from './bubble-menu.js';
import { InlineOverlays } from './inline-overlays.js';
import { Editor } from '@tiptap/core';
import { editorExtensions, parseMarkdown, serializeMarkdown, isHttpUrl } from './markdown.js';
import { formatMarkdownSelection, inspectMarkdownFormatting, moveSourceLines } from './source-formatting.js';
import { shortcutKey, isMismatchedCtrlLetter } from './shortcuts.js';

export class MarkdownEditor {
  constructor(visualElement, sourceElement, onChange, onSelectionChange = () => {}, onBubbleCommand = () => {}, overlayCallbacks = {}) {
    this.visualElement = visualElement;
    this.sourceElement = sourceElement;
    this.hybridElement = document.getElementById('hybrid-editor');
    this.onChange = onChange;
    this.onSelectionChange = onSelectionChange;
    this.onBubbleCommand = onBubbleCommand;
    this.overlayCallbacks = overlayCallbacks;
    this.mode = 'source';
    this.readonly = false;
    sourceElement.addEventListener('input', () => onChange());
    sourceElement.addEventListener('keyup', () => onSelectionChange());
    sourceElement.addEventListener('mouseup', () => onSelectionChange());
    sourceElement.addEventListener('select', () => onSelectionChange());
    sourceElement.addEventListener('keydown', event => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
        if (this.moveCurrent(event.key === 'ArrowUp' ? -1 : 1)) {
          event.preventDefault();
          event.stopPropagation();
          this.onChange();
          this.onSelectionChange();
        }
        return;
      }
      if (!event.ctrlKey || event.altKey || event.shiftKey) return;
      const key = shortcutKey(event);
      if (key === 'b' || key === 'i') { event.preventDefault(); this.format(key === 'b' ? 'bold' : 'italic'); }
    });
    sourceElement.addEventListener('paste', event => {
      if (this.readonly || sourceElement.selectionStart === sourceElement.selectionEnd) return;
      const pasted = event.clipboardData?.getData('text/plain')?.trim();
      if (!isHttpUrl(pasted)) return;
      event.preventDefault();
      this.formatSource('link', pasted);
    });
  }
  load(source, mode, path) {
    this.path = path;
    this.visualChanged = false;
    this.documentSource = null;
    this.blockControls?.destroy();
    this.blockControls = null;
    this.tableControls?.destroy();
    this.tableControls = null;
    this.inlineOverlays?.destroy();
    this.inlineOverlays = null;
    this.bubbleMenu?.destroy();
    this.bubbleMenu = null;
    this.hybridView?.destroy();
    this.hybridView = null;
    this.editor?.destroy();
    this.editor = null;
    this.sourceElement.value = source;
    this.mode = mode;
    let warning = '';
    if (mode === 'hybrid') {
      try {
        this.documentSource = readDocumentSource(source, isMdbbcode(path));
        this.hybridView = new HybridEditor(this.hybridElement, this.documentSource.body, this.onChange, this.onSelectionChange, this.overlayCallbacks);
        this.bubbleMenu = new BubbleMenu(this.hybridView.createBubbleAdapter(), this.hybridElement, (command, value) => this.onBubbleCommand(command, value));
      } catch (error) { warning = `Source view preserves this document: ${error.message}`; this.mode = 'source'; }
    }
    if (mode === 'visual') {
      try {
        this.documentSource = readDocumentSource(source, isMdbbcode(path));
        const content = parseMarkdown(this.documentSource.body);
        this.editor = new Editor({
          element: this.visualElement, extensions: editorExtensions, content,
          editable: !this.readonly,
          editorProps: {
            attributes: { 'aria-label': 'Visual Markdown Editor', role: 'textbox', spellcheck: 'true' },
            handleClick: (view, position, event) => Boolean(event.target.closest('a')),
            handleDOMEvents: { keydown: (view, event) => isMismatchedCtrlLetter(event) },
          },
          onUpdate: () => { this.visualChanged = true; this.onChange(); },
          onSelectionUpdate: () => this.onSelectionChange(),
          onTransaction: () => this.onSelectionChange(),
        });
        this.blockControls = new BlockControls(this.editor, this.visualElement, {
          onInsertImage: () => this.overlayCallbacks.onInsertImage?.(),
        });
        this.tableControls = new TableEdgeControls(this.editor, this.visualElement);
        this.inlineOverlays = new InlineOverlays(this.editor, this.visualElement, this.overlayCallbacks);
        this.bubbleMenu = new BubbleMenu(this.editor, this.visualElement, (command, value) => this.onBubbleCommand(command, value));
      } catch (error) { warning = `Source view preserves this document: ${error.message}`; this.mode = 'source'; }
    }
    this.hybridElement.hidden = this.mode !== 'hybrid';
    this.visualElement.hidden = this.mode !== 'visual';
    this.sourceElement.hidden = this.mode !== 'source';
    this.sourceElement.readOnly = this.readonly;
    return warning;
  }
  val() { return this.mode === 'source' ? this.sourceElement.value : this.mode === 'hybrid' ? this.documentSource.prefix + this.hybridView.val() : this.documentSource.prefix + (this.visualChanged ? serializeMarkdown(this.editor.getJSON()) : this.documentSource.body); }
  setTarget(target) {
    if (this.readonly || this.sourceMode() || target !== 'nexus') return;
    const source = withDocumentMetadata(this.val(), target);
    this.load(source, this.mode, this.path);
    this.onChange();
  }
  formattingState() {
    if (this.mode === 'hybrid') return this.hybridView?.formattingState() || null;
    if (this.sourceMode()) return inspectMarkdownFormatting(this.sourceElement.value, this.sourceElement.selectionStart, this.sourceElement.selectionEnd);
    if (!this.editor) return null;
    const editor = this.editor;
    const active = name => editor.isActive(name);
    const paragraphStyles = new Set();
    const selection = editor.state.selection;
    const recordStyle = node => {
      if (node.isTextblock) paragraphStyles.add(node.type.name === 'heading' ? String(node.attrs.level) : node.type.name === 'paragraph' ? '0' : 'other');
    };
    if (selection.empty) recordStyle(selection.$from.parent);
    else editor.state.doc.nodesBetween(selection.from, selection.to, recordStyle);
    let tableHeader = false;
    if (active('table')) {
      for (let depth = selection.$from.depth; depth > 0; depth--) {
        const node = selection.$from.node(depth);
        if (node.type.name === 'table') {
          tableHeader = node.firstChild?.firstChild?.type.name === 'tableHeader';
          break;
        }
      }
    }
    return {
      heading: paragraphStyles.size === 1 ? [...paragraphStyles][0] : 'mixed',
      bold: active('bold'), italic: active('italic'), strike: active('strike'),
      task: active('taskList'), table: active('table'), tableHeader, callout: active('callout'),
      bullet: active('bulletList'), numbered: active('orderedList'), quote: active('blockquote'),
      code: active('codeBlock') || active('code'), link: active('link'), image: active('image'),
      spoiler: active('spoiler') || active('spoilerBlock'), center: active('centerBlock'),
      color: active('textColor') ? editor.getAttributes('textColor').color : null,
    };
  }
  sourceMode() { return this.mode === 'source'; }
  activeLinkHref() { return this.mode === 'visual' && this.editor?.isActive('link') ? this.editor.getAttributes('link').href || '' : ''; }
  duplicateCurrent() {
    if (this.readonly) return false;
    if (this.mode === 'visual' && this.blockControls) return this.blockControls.duplicateBlock();
    if (this.mode === 'hybrid' && this.hybridView) return this.hybridView.duplicateActiveBlock();
    return false;
  }
  moveCurrent(direction) {
    if (this.readonly) return false;
    if (this.mode === 'visual' && this.blockControls) return this.blockControls.moveByStep(direction);
    if (this.mode === 'hybrid' && this.hybridView) return this.hybridView.moveActiveBlock(direction);
    if (this.sourceMode()) {
      const result = moveSourceLines(this.sourceElement.value, this.sourceElement.selectionStart, this.sourceElement.selectionEnd, direction);
      if (!result) return false;
      this.sourceElement.value = result.value;
      this.sourceElement.setSelectionRange(result.start, result.end);
      this.sourceElement.focus();
      return true;
    }
    return false;
  }
  undo(redo = false) {
    if (this.readonly) return false;
    if (this.mode === 'hybrid') return Boolean(this.hybridView?.undo(redo));
    if (this.mode === 'visual' && this.editor) return Boolean(redo ? this.editor.commands.redo() : this.editor.commands.undo());
    return false;
  }
  selectAll() {
    if (this.mode === 'hybrid') return Boolean(this.hybridView?.selectAll());
    if (this.mode === 'visual' && this.editor) return Boolean(this.editor.commands.selectAll());
    return false;
  }
  focus() { if (this.mode === 'hybrid') { this.hybridView.focus(); return; } if (this.sourceMode()) this.sourceElement.focus(); else this.editor.commands.focus(); }
  readOnly(value) { this.readonly = value; this.sourceElement.readOnly = value; this.editor?.setEditable(!value); this.hybridView?.readOnly(value); }

  selectionBookmark() {
    if (this.mode === 'hybrid') return this.hybridView.selectionBookmark();
    return this.sourceMode() ? { start: this.sourceElement.selectionStart, end: this.sourceElement.selectionEnd, direction: this.sourceElement.selectionDirection } : this.editor.state.selection.getBookmark();
  }
  restoreSelection(bookmark) {
    if (this.mode === 'hybrid') { this.hybridView.restoreSelection(bookmark); return; }
    if (this.sourceMode()) this.sourceElement.setSelectionRange(bookmark.start, bookmark.end, bookmark.direction);
    else this.editor.view.dispatch(this.editor.state.tr.setSelection(bookmark.resolve(this.editor.state.doc)));
    this.focus();
  }

  // ==> Section 2 - Formatting Commands <==
  format(command, value) {
    if (this.readonly) return false;
    if (this.mode === 'hybrid') return this.hybridView.format(command, value);
    if (this.sourceMode()) return this.formatSource(command, value);
    const chain = this.editor.chain().focus();
    const actions = {
      bold: () => chain.toggleBold(), italic: () => chain.toggleItalic(), strike: () => chain.toggleStrike(),
      bullet: () => chain.toggleBulletList(), numbered: () => chain.toggleOrderedList(), quote: () => chain.toggleBlockquote(),
      task: () => chain.toggleTaskList(),
      table: () => {
        const { rows = 3, cols = 2, withHeaderRow = true } = value && typeof value === 'object' ? value : {};
        return chain.insertTable({ rows, cols, withHeaderRow });
      },
      callout: () => chain.toggleWrap('callout', { type: 'note', title: '', fold: null }),
      toggle: () => chain.toggleWrap('callout', { type: 'note', title: '', fold: '-' }),
      divider: () => chain.setHorizontalRule(),
      turnInto: () => {
        if (value === 'paragraph') return chain.setParagraph();
        if (value?.startsWith('heading')) return chain.setHeading({ level: Number(value.at(-1)) });
        if (value === 'bulletList') return chain.toggleBulletList();
        if (value === 'orderedList') return chain.toggleOrderedList();
        if (value === 'taskList') return chain.toggleTaskList();
        if (value === 'blockquote') return chain.toggleBlockquote();
        if (value === 'codeBlock') return chain.toggleCodeBlock();
        if (value === 'callout') return chain.toggleWrap('callout', { type: 'note', title: '', fold: null });
        if (value === 'spoilerBlock') return this.editor.isActive('spoilerBlock') ? chain.lift('spoilerBlock') : chain.wrapIn('spoilerBlock');
        if (value === 'centerBlock') return chain.toggleWrap('centerBlock');
        return null;
      },
      addRowBefore: () => chain.addRowBefore(), addRowAfter: () => chain.addRowAfter(), deleteRow: () => chain.deleteRow(),
      addColumnBefore: () => chain.addColumnBefore(), addColumnAfter: () => chain.addColumnAfter(), deleteColumn: () => chain.deleteColumn(),
      toggleHeaderRow: () => chain.toggleHeaderRow(), deleteTable: () => chain.deleteTable(),
      code: () => chain.toggleCodeBlock(), inlineCode: () => chain.toggleCode(), center: () => chain.toggleWrap('centerBlock'),
      color: () => chain.setMark('textColor', { color: value }), clearColor: () => chain.unsetMark('textColor'), clear: () => chain.unsetAllMarks(),
      heading: () => Number(value) ? chain.setHeading({ level: Number(value) }) : chain.setParagraph(),
      link: () => chain.extendMarkRange('link').setLink({ href: value }), unlink: () => chain.extendMarkRange('link').unsetLink(),
      image: () => chain.setImage(typeof value === 'object' ? value : { src: value }),
      spoiler: () => {
        const selection = this.editor.state.selection;
        if (this.editor.isActive('spoilerBlock')) return chain.lift('spoilerBlock');
        return !selection.empty && selection.$from.sameParent(selection.$to) ? chain.toggleMark('spoiler') : chain.wrapIn('spoilerBlock');
      },
    };
    return actions[command]?.().run();
  }
  formatSource(command, value) {
    const textarea = this.sourceElement;
    const change = formatMarkdownSelection(textarea.value, textarea.selectionStart, textarea.selectionEnd, command, value);
    if (!change) return false;
    textarea.setRangeText(change.insert, change.from, change.to);
    textarea.setSelectionRange(change.start, change.end);
    textarea.focus();
    this.onChange();
    this.onSelectionChange();
    return true;
  }
}
