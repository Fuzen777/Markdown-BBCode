// ==> Section 1 - Dual-Mode Right-Side Document Outline <==
import { setButtonIcon } from './icons.js';
import { matchOpeningFence, isClosingFence } from './code-fence.js';

function cleanHeadingTitle(raw) {
  return raw
    .replace(/<span\s+style=(['"])\s*color:[^'"]+\1\s*>([\s\S]*?)<\/span>/gi, '$2')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\|\|/g, '')
    .replace(/[`*_~]/g, '')
    .trim();
}

export function extractOutlineHeadings(editor) {
  if (!editor) return [];
  if (editor.mode === 'visual' && editor.editor) {
    const headings = [];
    editor.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        headings.push({
          level: node.attrs.level || 1,
          text: node.textContent.trim() || `Heading ${node.attrs.level || 1}`,
          pos,
        });
      }
    });
    return headings;
  }

  if (editor.mode === 'hybrid' && editor.hybridView) {
    const headings = [];
    editor.hybridView.blocks.forEach((block, blockIndex) => {
      if (block.type === 'space' || block.type === 'code') return;
      let inCode = false;
      let fenceChar = '';
      let fenceLength = 0;
      for (const rawLine of block.raw.split(/\r?\n/)) {
        const stripped = rawLine.replace(/^(?: {0,3}>[ \t]?)+/, '');
        if (!inCode) {
          const openFence = matchOpeningFence(stripped);
          if (openFence) {
            inCode = true;
            fenceChar = openFence.char;
            fenceLength = openFence.length;
            continue;
          }
        } else {
          if (isClosingFence(stripped, fenceChar, fenceLength)) {
            inCode = false;
            fenceChar = '';
            fenceLength = 0;
          }
          continue;
        }
        const match = stripped.trim().match(/^(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*$/);
        if (match) {
          headings.push({
            level: match[1].length,
            text: cleanHeadingTitle(match[2] || '') || `Heading ${match[1].length}`,
            blockIndex,
          });
        }
      }
    });
    return headings;
  }

  if (editor.sourceMode()) {
    const source = editor.sourceElement.value || '';
    const headings = [];
    const lines = source.split('\n');
    let offset = 0;
    let inFence = false;
    let fenceChar = '';
    let fenceLength = 0;
    let lineStart = 0;
    if (/^\uFEFF?---\r?$/.test(lines[0] || '')) {
      const closing = lines.slice(1).findIndex(line => /^(?:---|\.\.\.)\r?$/.test(line));
      if (closing >= 0) {
        const skipCount = closing + 2;
        for (let i = 0; i < skipCount; i++) offset += lines[i].length + 1;
        lineStart = skipCount;
      }
    }
    for (let i = lineStart; i < lines.length; i++) {
      const line = lines[i];
      const textLine = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (!inFence) {
        const openFence = matchOpeningFence(textLine);
        if (openFence) {
          inFence = true;
          fenceChar = openFence.char;
          fenceLength = openFence.length;
        } else {
          const match = textLine.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*$/);
          if (match) {
            headings.push({
              level: match[1].length,
              text: cleanHeadingTitle(match[2] || '') || `Heading ${match[1].length}`,
              lineIndex: i,
              totalLines: lines.length,
              charStart: offset,
              charEnd: offset + textLine.length,
            });
          }
        }
      } else if (isClosingFence(textLine, fenceChar, fenceLength)) {
        inFence = false;
        fenceChar = '';
        fenceLength = 0;
      }
      offset += line.length + 1;
    }
    return headings;
  }
  return [];
}

export class DocumentOutline {
  constructor(elements, getEditor, onModeChange = () => {}) {
    this.elements = elements;
    this.getEditor = getEditor;
    this.onModeChange = onModeChange;
    this.mode = 'off';
    this.headings = [];
    this.activeIndex = -1;
    this.hidePopoverTimer = null;
    this.rafPending = false;

    setButtonIcon(elements['outline-pin-dock'], 'push_pin', 'Pin To Dock', 'Pin To Dock');
    setButtonIcon(elements['outline-unpin-float'], 'push_pin', 'Switch To Floating Outline', 'Switch To Floating Outline');
    setButtonIcon(elements['outline-docked-close'], 'close', 'Hide Document Outline', 'Hide Document Outline');

    elements['outline-off'].onclick = () => this.setMode('off', true);
    elements['outline-floating'].onclick = () => this.setMode('floating', true);
    elements['outline-docked'].onclick = () => this.setMode('docked', true);
    elements['outline-pin-dock'].onclick = () => this.setMode('docked', true);
    elements['outline-unpin-float'].onclick = () => this.setMode('floating', true);
    elements['outline-docked-close'].onclick = () => this.setMode('off', true);

    const rail = elements['outline-floating-rail'];
    const ticks = elements['outline-floating-ticks'];
    const popover = elements['outline-floating-popover'];
    const openPopover = () => {
      clearTimeout(this.hidePopoverTimer);
      if (this.mode === 'floating') popover.hidden = false;
    };
    const scheduleClosePopover = () => {
      clearTimeout(this.hidePopoverTimer);
      this.hidePopoverTimer = setTimeout(() => {
        if (!rail.contains(document.activeElement) && !ticks.matches(':hover') && !popover.matches(':hover')) {
          popover.hidden = true;
        }
      }, 160);
    };
    ticks.addEventListener('pointerenter', openPopover);
    popover.addEventListener('pointerenter', openPopover);
    ticks.addEventListener('pointerleave', scheduleClosePopover);
    popover.addEventListener('pointerleave', scheduleClosePopover);
    rail.addEventListener('focusin', openPopover);
    rail.addEventListener('focusout', event => {
      if (!rail.contains(event.relatedTarget)) popover.hidden = true;
    });

    for (const scroller of [elements['visual-editor'], elements['hybrid-editor'], elements['markdown-source']]) {
      scroller.addEventListener('scroll', () => this.scheduleScrollSync());
    }
    this.setMode('off', false);
  }

  setMode(mode, notify = false) {
    const next = mode === 'floating' || mode === 'docked' ? mode : 'off';
    const changed = this.mode !== next;
    this.mode = next;
    this.elements['outline-off'].setAttribute('aria-pressed', String(next === 'off'));
    this.elements['outline-floating'].setAttribute('aria-pressed', String(next === 'floating'));
    this.elements['outline-docked'].setAttribute('aria-pressed', String(next === 'docked'));
    this.elements['outline-floating-rail'].hidden = next !== 'floating';
    this.elements['outline-floating-popover'].hidden = true;
    this.elements['outline-docked-pane'].hidden = next !== 'docked';
    this.refresh();
    if (notify && changed) this.onModeChange(next);
  }

  scheduleScrollSync() {
    if (this.mode === 'off' || this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.updateActiveHeading();
    });
  }

  refresh() {
    if (this.mode === 'off') return;
    const editor = this.getEditor();
    this.headings = extractOutlineHeadings(editor);
    this.renderLists();
    this.updateActiveHeading();
  }

  renderLists() {
    const ticks = this.elements['outline-floating-ticks'];
    const floatingList = this.elements['outline-floating-list'];
    const dockedList = this.elements['outline-docked-list'];
    ticks.replaceChildren();
    floatingList.replaceChildren();
    dockedList.replaceChildren();

    if (!this.headings.length) {
      const emptyTick = document.createElement('span');
      emptyTick.className = 'outline-tick outline-tick-empty';
      ticks.append(emptyTick);
      for (const container of [floatingList, dockedList]) {
        const empty = document.createElement('div');
        empty.className = 'outline-empty';
        empty.textContent = 'No Headings';
        container.append(empty);
      }
      return;
    }

    this.headings.forEach((heading, index) => {
      const tick = document.createElement('span');
      tick.className = `outline-tick level-${heading.level}`;
      ticks.append(tick);

      for (const container of [floatingList, dockedList]) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = `outline-item level-${heading.level}`;
        item.dataset.headingIndex = String(index);
        item.textContent = heading.text;
        item.title = heading.text;
        item.onclick = () => this.jumpTo(index);
        container.append(item);
      }
    });
  }

  updateActiveHeading() {
    if (!this.headings.length) { this.activeIndex = -1; return; }
    const editor = this.getEditor();
    let nextActive = 0;

    if (editor?.mode === 'visual' && editor.editor && !editor.editor.isDestroyed) {
      const scrollerRect = this.elements['visual-editor'].getBoundingClientRect();
      const threshold = scrollerRect.top + 36;
      for (let i = 0; i < this.headings.length; i++) {
        const dom = editor.editor.view.nodeDOM(this.headings[i].pos);
        if (dom instanceof Element && dom.getBoundingClientRect().top <= threshold) nextActive = i;
      }
    } else if (editor?.mode === 'hybrid' && editor.hybridView) {
      const scrollerRect = this.elements['hybrid-editor'].getBoundingClientRect();
      const threshold = scrollerRect.top + 36;
      for (let i = 0; i < this.headings.length; i++) {
        const shell = this.elements['hybrid-blocks'].children[this.headings[i].blockIndex];
        if (shell && shell.getBoundingClientRect().top <= threshold) nextActive = i;
      }
    } else if (editor?.sourceMode()) {
      const source = this.elements['markdown-source'];
      const currentLine = (source.scrollTop / Math.max(1, source.scrollHeight)) * (this.headings[0].totalLines || 1);
      for (let i = 0; i < this.headings.length; i++) {
        if (this.headings[i].lineIndex <= currentLine + 2) nextActive = i;
      }
    }

    this.activeIndex = nextActive;
    for (const tick of this.elements['outline-floating-ticks'].children) tick.classList.remove('active');
    this.elements['outline-floating-ticks'].children[nextActive]?.classList.add('active');
    for (const container of [this.elements['outline-floating-list'], this.elements['outline-docked-list']]) {
      for (const button of container.querySelectorAll('.outline-item')) {
        button.classList.toggle('active', Number(button.dataset.headingIndex) === nextActive);
      }
    }
  }

  jumpTo(index) {
    const heading = this.headings[index];
    const editor = this.getEditor();
    if (!heading || !editor) return;
    if (editor.mode === 'visual' && editor.editor && !editor.editor.isDestroyed) {
      const dom = editor.editor.view.nodeDOM(heading.pos);
      dom?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      const targetPos = Math.min(heading.pos + 1, editor.editor.state.doc.content.size);
      editor.editor.chain().focus().setTextSelection(targetPos).run();
    } else if (editor.mode === 'hybrid' && editor.hybridView) {
      const shell = this.elements['hybrid-blocks'].children[heading.blockIndex];
      shell?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      editor.hybridView.activate(heading.blockIndex, true);
    } else if (editor.sourceMode()) {
      const textarea = this.elements['markdown-source'];
      textarea.focus();
      textarea.setSelectionRange(heading.charStart, heading.charStart);
      const ratio = heading.lineIndex / Math.max(1, heading.totalLines);
      textarea.scrollTop = Math.max(0, Math.min(ratio * textarea.scrollHeight, textarea.scrollHeight - textarea.clientHeight));
    }
    this.activeIndex = index;
    this.elements['outline-floating-popover'].hidden = true;
    this.updateActiveHeading();
  }
}
