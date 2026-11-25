// ==> Section 1 - Visual And Source Editor Adapter <==
import { readDocumentSource, isMdbbcode, withDocumentMetadata } from './document-format.js';
import { HybridEditor } from './hybrid-editor.js';
import { BlockControls } from './block-controls.js';
import { TableEdgeControls } from './table-controls.js';
import { BubbleMenu } from './bubble-menu.js';
import { InlineOverlays } from './inline-overlays.js';
import { Editor } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';
import { editorExtensions, parseMarkdown, serializeMarkdown, isHttpUrl } from './markdown.js';
import { formatMarkdownSelection, inspectMarkdownFormatting, moveSourceLines } from './source-formatting.js';
import { shortcutKey, isMismatchedCtrlLetter } from './shortcuts.js';
import { describeEditorFallback } from './editor-errors.js';
import { planVisualPatch } from './doc-patch.js';

let propertiesModule = null;
let propertiesLoading = null;

export class MarkdownEditor {
  constructor(visualElement, sourceElement, onChange, onSelectionChange = () => {}, onBubbleCommand = () => {}, overlayCallbacks = {}) {
    this.visualElement = visualElement;
    this.sourceElement = sourceElement;
    this.hybridElement = document.getElementById('hybrid-editor');
    this.hybridBlocks = document.getElementById('hybrid-blocks');
    this.properties = null;
    this.loadToken = 0;
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
  // Visual/Hybrid could not open the document: keep Source (authoritative, still saveable) and
  // report a coded error. Lines count from the top of the file, front matter included.
  fallBackToSource(error, mode, source) {
    this.editor?.destroy();
    this.editor = null;
    this.hybridView?.destroy();
    this.hybridView = null;
    this.documentSource = null;
    this.mode = 'source';
    let prefixLines = 0;
    try { prefixLines = (readDocumentSource(source, isMdbbcode(this.path)).prefix.match(/\n/g) || []).length; } catch { /* YAML error: no prefix */ }
    this.fallbackError = describeEditorFallback(error, mode, prefixLines);
    return this.fallbackError.message;
  }

  load(source, mode, path) {
    this.loadToken++;
    this.properties?.detach();
    this.path = path;
    this.fallbackError = null;
    this.visualChanged = false;
    this.visualSnapshots = [];
    this.sourceUndo = [];
    this.sourceRedo = [];
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
        this.hybridView = new HybridEditor(this.hybridBlocks, this.documentSource.body, this.onChange, this.onSelectionChange, {
          ...this.overlayCallbacks, scroller: this.hybridElement, onAddProperties: () => this.showProperties({ add: true }),
        });
        this.bubbleMenu = new BubbleMenu(this.hybridView.createBubbleAdapter(), this.hybridElement, (command, value) => this.onBubbleCommand(command, value));
      } catch (error) { warning = this.fallBackToSource(error, 'hybrid', source); }
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
        this.visualSnapshots = [{ doc: this.editor.state.doc, body: this.documentSource.body }];
        this.blockControls = new BlockControls(this.editor, this.visualElement, {
          onInsertImage: () => this.overlayCallbacks.onInsertImage?.(),
          onAddProperties: () => this.showProperties({ add: true }),
        });
        this.tableControls = new TableEdgeControls(this.editor, this.visualElement);
        this.inlineOverlays = new InlineOverlays(this.editor, this.visualElement, this.overlayCallbacks);
        this.bubbleMenu = new BubbleMenu(this.editor, this.visualElement, (command, value) => this.onBubbleCommand(command, value));
      } catch (error) { warning = this.fallBackToSource(error, 'visual', source); }
    }
    this.hybridElement.hidden = this.mode !== 'hybrid';
    this.visualElement.hidden = this.mode !== 'visual';
    this.sourceElement.hidden = this.mode !== 'source';
    this.sourceElement.readOnly = this.readonly;
    if (this.documentSource?.prefix) this.showProperties();
    return warning;
  }

  // ==> Section 1B - Properties Panel (lazy chunk) <==
  // Shown above Visual and Hybrid when the document has front matter, or on demand to add some.
  // The chunk is imported the first time it is needed, so files without front matter pay nothing.
  showProperties({ add = false } = {}) {
    const host = this.mode === 'visual' ? this.visualElement : this.mode === 'hybrid' ? this.hybridElement : null;
    if (!host || !this.documentSource) return;
    const token = this.loadToken;
    const mount = ({ PropertiesPanel }) => {
      if (token !== this.loadToken || !this.documentSource) return;
      this.properties ??= new PropertiesPanel({
        commit: prefix => this.replacePrefix(prefix, { fromPanel: true }),
        getCollapsed: () => this.overlayCallbacks.getPropertiesCollapsed?.() ?? false,
        setCollapsed: collapsed => this.overlayCallbacks.setPropertiesCollapsed?.(collapsed),
        copyText: text => this.overlayCallbacks.onCopyText?.(text),
      });
      if (this.properties.element.parentElement !== host) {
        host.prepend(this.properties.element);
        this.properties.load(this.documentSource.prefix, this.currentBody());
        this.properties.readOnly(this.readonly);
      }
      if (add) this.properties.startAdding();
    };
    if (propertiesModule) { mount(propertiesModule); return; }
    propertiesLoading ??= import('./properties/properties-panel.js').then(module => { propertiesModule = module; return module; })
      .catch(error => { propertiesLoading = null; throw error; });
    propertiesLoading.then(mount).catch(error => this.overlayCallbacks.onError?.(error));
  }
  propertiesFocused() { return Boolean(this.properties?.element.isConnected && this.properties.element.contains(document.activeElement)); }
  undoProperties(redo = false) { return Boolean(this.properties?.undo(redo)); }
  currentBody() { return this.val().slice(this.documentSource.prefix.length); }

  // Replaces the front matter while Visual or Hybrid is open, leaving the editor body, its undo
  // history and selection untouched. Returns false (and changes nothing) when the new front matter
  // would change how the body parses, such as a body that itself starts with `---`.
  replacePrefix(prefix, { fromPanel = false } = {}) {
    if (this.readonly || this.sourceMode() || !this.documentSource) return false;
    if (prefix === this.documentSource.prefix) return true;
    const body = this.currentBody();
    const parsed = readDocumentSource(prefix + body, isMdbbcode(this.path));
    if (parsed.body !== body || parsed.prefix !== prefix) throw new Error('Could not update the front matter here. Switch to Source to edit it.');
    Object.assign(this.documentSource, {
      prefix: parsed.prefix, yaml: parsed.yaml, target: parsed.target, legacyMetadata: parsed.legacyMetadata, explicitTarget: parsed.explicitTarget,
    });
    if (!fromPanel && this.properties?.element.isConnected) this.properties.load(parsed.prefix, body);
    else if (!fromPanel && parsed.prefix) this.showProperties();
    this.onChange();
    return true;
  }
  val() { return this.mode === 'source' ? this.sourceElement.value : this.mode === 'hybrid' ? this.documentSource.prefix + this.hybridView.val() : this.documentSource.prefix + this.visualBody(); }

  // ==> Section 1C - Exact Visual Source Snapshots <==
  // Visual serialization can normalize Markdown. While the editor document equals a state whose
  // exact source is known (as loaded, or produced by a patched lint fix, including after Ctrl+Z /
  // Ctrl+Y), that source is returned instead, so untouched documents never change bytes.
  visualBody() {
    if (!this.visualChanged) return this.documentSource.body;
    const doc = this.editor.state.doc;
    for (let index = this.visualSnapshots.length - 1; index >= 0; index--) {
      if (this.visualSnapshots[index].doc.eq(doc)) return this.visualSnapshots[index].body;
    }
    return serializeMarkdown(this.editor.getJSON());
  }

  // Undo/redo of a source-only Visual fix, valid only while the document and its source are still
  // exactly the state that fix produced (or reverted to).
  undoSourceOnly(redo) {
    const stack = redo ? this.sourceRedo : this.sourceUndo;
    const entry = stack.at(-1);
    if (!entry || !entry.doc.eq(this.editor.state.doc) || this.visualBody() !== (redo ? entry.before : entry.after)) return false;
    stack.pop();
    (redo ? this.sourceUndo : this.sourceRedo).push(entry);
    this.rememberVisualSnapshot(entry.doc, redo ? entry.after : entry.before);
    this.visualChanged = true;
    this.onChange();
    return true;
  }

  rememberVisualSnapshot(doc, body) {
    this.visualSnapshots.push({ doc, body });
    if (this.visualSnapshots.length > 40) this.visualSnapshots.splice(1, this.visualSnapshots.length - 40);
  }

  // Applies a new Visual body (e.g. a lint fix) as one undoable transaction that replaces only the
  // top-level blocks that differ. Returns false when that is not possible; the caller then falls back.
  applyVisualBodyChange(nextBody) {
    if (this.mode !== 'visual' || !this.editor || this.readonly) return false;
    const currentBody = this.visualBody();
    const plan = planVisualPatch({ schema: this.editor.schema, state: this.editor.state, nextBody, parseMarkdown });
    if (!plan.safe) { this.lastPatchFailure = plan.reason; return false; }
    this.rememberVisualSnapshot(this.editor.state.doc, currentBody);
    if (!plan.transaction) {
      // Source-only fixes (spacing, blank lines, list indents) parse to the same document. ProseMirror
      // has no step for them, so they get their own undo entry that Ctrl+Z / Ctrl+Y consult first.
      this.rememberVisualSnapshot(this.editor.state.doc, nextBody);
      this.sourceUndo.push({ doc: this.editor.state.doc, before: currentBody, after: nextBody });
      this.sourceRedo = [];
      this.visualChanged = true;
      this.onChange();
      return true;
    }
    this.rememberVisualSnapshot(plan.transaction.doc, nextBody);
    this.visualChanged = true;
    this.editor.view.dispatch(plan.transaction.scrollIntoView());
    return true;
  }
  setTarget(target) {
    if (this.readonly || this.sourceMode() || !['nexus', 'steam'].includes(target)) return;
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
    if (this.mode === 'visual' && this.editor) {
      if (this.undoSourceOnly(redo)) return true;
      return Boolean(redo ? this.editor.commands.redo() : this.editor.commands.undo());
    }
    return false;
  }
  selectAll() {
    if (this.mode === 'hybrid') return Boolean(this.hybridView?.selectAll());
    if (this.mode === 'visual' && this.editor) return Boolean(this.editor.commands.selectAll());
    return false;
  }
  focus() { if (this.mode === 'hybrid') { this.hybridView.focus(); return; } if (this.sourceMode()) this.sourceElement.focus(); else this.editor.commands.focus(); }
  // Puts the caret in the n-th top-level block (Hybrid: n-th non-blank block) without scrolling, so a mode switch keeps the view.
  focusBlock(index) {
    if (this.mode === 'hybrid' && this.hybridView) { this.hybridView.focusContentBlock(index); return; }
    if (this.mode !== 'visual' || !this.editor || index < 0 || index >= this.editor.state.doc.childCount) { this.focus(); return; }
    let position = 0;
    for (let child = 0; child < index; child++) position += this.editor.state.doc.child(child).nodeSize;
    const { state, view } = this.editor;
    view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(position), 1)));
    view.focus();
  }
  // setEditable(…, false): Tiptap otherwise emits a content-free `update`, which would mark Visual as
  // edited and re-serialize (normalize) the document every time a dialog opens.
  readOnly(value) { this.readonly = value; this.sourceElement.readOnly = value; this.editor?.setEditable(!value, false); this.hybridView?.readOnly(value); this.properties?.readOnly(value); }

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
        if (value === 'centerBlock') return chain.toggleCenter();
        return null;
      },
      addRowBefore: () => chain.addRowBefore(), addRowAfter: () => chain.addRowAfter(), deleteRow: () => chain.deleteRow(),
      addColumnBefore: () => chain.addColumnBefore(), addColumnAfter: () => chain.addColumnAfter(), deleteColumn: () => chain.deleteColumn(),
      toggleHeaderRow: () => chain.toggleHeaderRow(), deleteTable: () => chain.deleteTable(),
      code: () => chain.toggleCodeBlock(), inlineCode: () => chain.toggleCode(), center: () => chain.toggleCenter(),
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
