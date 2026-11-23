// ==> Section 1 - Search Matching And ProseMirror Highlights <==
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const searchHighlightPluginKey = new PluginKey('searchHighlight');

export const SearchHighlight = Extension.create({
  name: 'searchHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: searchHighlightPluginKey,
        state: {
          init: () => ({ matches: [], activeIndex: -1 }),
          apply(transaction, previous, oldState, newState) {
            const meta = transaction.getMeta(searchHighlightPluginKey);
            if (meta) return meta;
            if (!transaction.docChanged || !previous.matches.length) return previous;
            return {
              matches: previous.matches
                .map(match => ({ from: transaction.mapping.map(match.from), to: transaction.mapping.map(match.to) }))
                .filter(match => match.from < match.to && match.to <= newState.doc.content.size),
              activeIndex: previous.activeIndex,
            };
          },
        },
        props: {
          decorations(state) {
            const pluginState = searchHighlightPluginKey.getState(state);
            if (!pluginState?.matches.length) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              pluginState.matches.map((match, index) =>
                Decoration.inline(match.from, match.to, {
                  class: index === pluginState.activeIndex ? 'search-match search-match-active' : 'search-match',
                })
              )
            );
          },
        },
      }),
    ];
  },
});

export function findTextMatches(text, query, caseSensitive = false) {
  if (!query) return [];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
  const matches = [];
  for (const match of text.matchAll(pattern)) {
    if (!match[0].length) continue;
    matches.push({ from: match.index, to: match.index + match[0].length });
  }
  return matches;
}

export function findProseMirrorMatches(doc, query, caseSensitive = false) {
  if (!query) return [];
  const matches = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true;
    let text = '';
    const charPositions = [];
    node.descendants((child, childOffset) => {
      if (child.isText) {
        const start = position + 1 + childOffset;
        for (let index = 0; index < child.text.length; index++) {
          text += child.text[index];
          charPositions.push(start + index);
        }
      } else if (child.isLeaf) {
        text += child.type.name === 'hardBreak' ? '\n' : ' ';
        charPositions.push(position + 1 + childOffset);
      }
      return true;
    });
    for (const match of findTextMatches(text, query, caseSensitive)) {
      const from = charPositions[match.from];
      const to = charPositions[match.to - 1] + 1;
      if (typeof from === 'number' && typeof to === 'number' && from < to) matches.push({ from, to });
    }
    return false;
  });
  return matches;
}

// ==> Section 2 - Cross-Mode Find And Replace Controller <==
export class FindReplaceController {
  constructor(elements, getEditor, onDocumentChanged) {
    this.elements = elements;
    this.getEditor = getEditor;
    this.onDocumentChanged = onDocumentChanged;
    this.matches = [];
    this.activeIndex = -1;
    this.caseSensitive = false;
    this.isMutating = false;

    const bar = elements['find-bar'];
    elements['find-input'].oninput = () => this.refresh();
    elements['find-input'].onkeydown = event => {
      if (event.key === 'Enter') { event.preventDefault(); this.step(event.shiftKey ? -1 : 1); }
    };
    elements['find-replace-input'].onkeydown = event => {
      if (event.key === 'Enter') { event.preventDefault(); this.replaceCurrent(); }
    };
    bar.onkeydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); }
    };
    elements['find-case'].onclick = () => {
      this.caseSensitive = !this.caseSensitive;
      elements['find-case'].setAttribute('aria-pressed', String(this.caseSensitive));
      this.refresh();
    };
    elements['find-prev'].onclick = () => this.step(-1);
    elements['find-next'].onclick = () => this.step(1);
    elements['find-replace-toggle'].onclick = () => this.setReplaceVisible(elements['find-replace-row'].hidden);
    elements['find-close'].onclick = () => this.close();
    elements['find-replace-one'].onclick = () => this.replaceCurrent();
    elements['find-replace-all'].onclick = () => this.replaceAll();
  }

  isOpen() { return !this.elements['find-bar'].hidden; }

  setReplaceVisible(visible) {
    this.elements['find-replace-row'].hidden = !visible;
    this.elements['find-replace-toggle'].setAttribute('aria-expanded', String(visible));
    this.elements['find-replace-toggle'].setAttribute('aria-pressed', String(visible));
  }

  open(showReplace = false, initialQuery) {
    this.elements['find-bar'].hidden = false;
    this.elements['find-toggle']?.setAttribute('aria-pressed', 'true');
    if (showReplace) this.setReplaceVisible(true);
    if (typeof initialQuery === 'string' && initialQuery && !initialQuery.includes('\n')) {
      this.elements['find-input'].value = initialQuery;
    }
    this.refresh();
    this.elements['find-input'].focus();
    this.elements['find-input'].select();
  }

  close() {
    this.elements['find-bar'].hidden = true;
    this.elements['find-toggle']?.setAttribute('aria-pressed', 'false');
    this.matches = [];
    this.activeIndex = -1;
    this.clearVisualHighlights();
    this.getEditor()?.focus();
  }

  clearVisualHighlights() {
    const editor = this.getEditor();
    if (editor?.mode === 'visual' && editor.editor) {
      editor.editor.view.dispatch(editor.editor.state.tr.setMeta(searchHighlightPluginKey, { matches: [], activeIndex: -1 }));
    }
  }

  computeMatches() {
    const editor = this.getEditor();
    const query = this.elements['find-input'].value;
    if (!editor || !query) return [];
    if (editor.mode === 'visual' && editor.editor) return findProseMirrorMatches(editor.editor.state.doc, query, this.caseSensitive);
    if (editor.mode === 'hybrid' && editor.hybridView) return findTextMatches(editor.hybridView.body, query, this.caseSensitive);
    if (editor.sourceMode()) return findTextMatches(editor.sourceElement.value, query, this.caseSensitive);
    return [];
  }

  updateStatus(navigate = false) {
    const query = this.elements['find-input'].value;
    const total = this.matches.length;
    this.elements['find-count'].textContent = !query ? '' : total ? `${this.activeIndex + 1} / ${total}` : 'No Matches';
    const editor = this.getEditor();
    if (editor?.mode === 'visual' && editor.editor) {
      editor.editor.view.dispatch(editor.editor.state.tr.setMeta(searchHighlightPluginKey, { matches: this.matches, activeIndex: this.activeIndex }));
      if (navigate && this.activeIndex >= 0) {
        requestAnimationFrame(() => editor.visualElement.querySelector('.search-match-active')?.scrollIntoView({ block: 'nearest' }));
      }
      return;
    }
    if (!navigate || this.activeIndex < 0) return;
    const match = this.matches[this.activeIndex];
    if (editor?.mode === 'hybrid' && editor.hybridView) editor.hybridView.selectBodyRange(match.from, match.to, false);
    else if (editor?.sourceMode()) editor.sourceElement.setSelectionRange(match.from, match.to);
  }

  refresh(keepIndex = false, navigate = true) {
    if (!this.isOpen()) return;
    this.matches = this.computeMatches();
    if (!this.matches.length) this.activeIndex = -1;
    else if (!keepIndex || this.activeIndex < 0 || this.activeIndex >= this.matches.length) this.activeIndex = 0;
    this.updateStatus(navigate);
  }

  syncOnEdit() {
    if (!this.isOpen() || this.isMutating) return;
    this.refresh(true, false);
  }

  step(delta) {
    if (!this.matches.length) return;
    this.activeIndex = (this.activeIndex + delta + this.matches.length) % this.matches.length;
    this.updateStatus(true);
  }

  replaceCurrent() {
    const editor = this.getEditor();
    if (!editor || editor.readonly) return;
    if (!this.matches.length) { this.refresh(); return; }
    if (this.activeIndex < 0) this.activeIndex = 0;
    const match = this.matches[this.activeIndex];
    const replacement = this.elements['find-replace-input'].value;
    const nextSearchOffset = match.from + replacement.length;

    this.isMutating = true;
    try {
      if (editor.mode === 'visual' && editor.editor) {
        editor.editor.view.dispatch(editor.editor.state.tr.insertText(replacement, match.from, match.to).scrollIntoView());
      } else if (editor.mode === 'hybrid' && editor.hybridView) {
        editor.hybridView.replaceBodyRange(match.from, match.to, replacement);
      } else if (editor.sourceMode()) {
        editor.sourceElement.setRangeText(replacement, match.from, match.to);
        editor.sourceElement.setSelectionRange(match.from, nextSearchOffset);
      }
      this.onDocumentChanged();
    } finally {
      this.isMutating = false;
    }

    this.matches = this.computeMatches();
    if (!this.matches.length) this.activeIndex = -1;
    else {
      const nextIndex = this.matches.findIndex(candidate => candidate.from >= nextSearchOffset);
      this.activeIndex = nextIndex >= 0 ? nextIndex : 0;
    }
    this.updateStatus(true);
  }

  replaceAll() {
    const editor = this.getEditor();
    if (!editor || editor.readonly || !this.matches.length) return;
    const replacement = this.elements['find-replace-input'].value;
    this.isMutating = true;
    try {
      if (editor.mode === 'visual' && editor.editor) {
        const transaction = editor.editor.state.tr;
        for (const match of [...this.matches].reverse()) transaction.insertText(replacement, match.from, match.to);
        editor.editor.view.dispatch(transaction.scrollIntoView());
      } else if (editor.mode === 'hybrid' && editor.hybridView) {
        editor.hybridView.replaceAllInBody(this.matches, replacement);
      } else if (editor.sourceMode()) {
        let nextValue = editor.sourceElement.value;
        for (const match of [...this.matches].reverse()) nextValue = nextValue.slice(0, match.from) + replacement + nextValue.slice(match.to);
        editor.sourceElement.setRangeText(nextValue, 0, editor.sourceElement.value.length);
      }
      this.onDocumentChanged();
    } finally {
      this.isMutating = false;
    }
    this.refresh(false, false);
  }
}
