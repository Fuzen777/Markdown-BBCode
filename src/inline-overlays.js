// ==> Section 1 - Inline Link, Code Block And Image Overlays <==
import { setButtonIcon, createIcon } from './icons.js';

const codeLanguages = [
  ['', 'Plain Text'],
  ['ini', 'INI'],
  ['lua', 'Lua'],
  ['papyrus', 'Papyrus'],
  ['xml', 'XML'],
  ['json', 'JSON'],
  ['yaml', 'YAML'],
  ['toml', 'TOML'],
  ['javascript', 'JavaScript'],
  ['typescript', 'TypeScript'],
  ['python', 'Python'],
  ['bash', 'Bash'],
  ['powershell', 'PowerShell'],
  ['css', 'CSS'],
  ['html', 'HTML'],
  ['markdown', 'Markdown'],
  ['sql', 'SQL'],
  ['c', 'C'],
  ['cpp', 'C++'],
  ['csharp', 'C#'],
  ['rust', 'Rust'],
];

export class InlineOverlays {
  constructor(editor, host, callbacks = {}) {
    this.editor = editor;
    this.host = host;
    this.callbacks = callbacks;
    this.hoveredLink = null;
    this.activeLinkData = null;
    this.hoveredCodePre = null;
    this.activeCodePos = null;
    this.hoveredImage = null;
    this.activeImagePos = null;
    this.linkHideTimer = null;
    this.codeHideTimer = null;
    this.imageHideTimer = null;

    this.linkPopover = this.createLinkPopover();
    this.codeOverlay = this.createCodeOverlay();
    this.imageOverlay = this.createImageOverlay();
    document.body.append(this.linkPopover, this.codeOverlay, this.imageOverlay);

    this.boundMove = event => this.pointerMove(event);
    this.boundScroll = () => this.update();
    this.boundTransaction = () => this.update();
    this.boundKey = event => {
      if (event.key === 'Escape') this.hideAll();
    };
    this.boundMediaError = event => {
      if (event.target?.tagName === 'IMG' && !event.target.classList.contains('ProseMirror-separator')) {
        event.target.dataset.broken = 'true';
        if (this.hoveredImage === event.target) this.updateImageOverlay();
      }
    };
    this.boundMediaLoad = event => {
      if (event.target?.tagName === 'IMG' && !event.target.classList.contains('ProseMirror-separator')) {
        delete event.target.dataset.broken;
        if (this.hoveredImage === event.target) this.updateImageOverlay();
      }
    };

    document.addEventListener('pointermove', this.boundMove);
    host.addEventListener('scroll', this.boundScroll);
    window.addEventListener('resize', this.boundScroll);
    document.addEventListener('keydown', this.boundKey, true);
    host.addEventListener('error', this.boundMediaError, true);
    host.addEventListener('load', this.boundMediaLoad, true);
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.update()) : null;
    this.resizeObserver?.observe(host);
    editor.on('selectionUpdate', this.boundTransaction);
    editor.on('transaction', this.boundTransaction);
  }

  createLinkPopover() {
    const popover = document.createElement('div');
    popover.className = 'link-popover';
    popover.setAttribute('role', 'toolbar');
    popover.setAttribute('aria-label', 'Link Actions');
    popover.hidden = true;

    this.linkUrlLabel = document.createElement('span');
    this.linkUrlLabel.className = 'link-popover-url';

    const makeBtn = (icon, label, action) => {
      const button = document.createElement('button');
      button.type = 'button';
      setButtonIcon(button, icon, label);
      button.onmousedown = event => event.preventDefault();
      button.onclick = action;
      return button;
    };

    this.linkOpenBtn = makeBtn('open_in_new', 'Open Link', () => {
      if (this.activeLinkData?.href) this.callbacks.onOpenUrl?.(this.activeLinkData.href);
    });
    this.linkCopyBtn = makeBtn('content_copy', 'Copy Link URL', () => {
      if (this.activeLinkData?.href) navigator.clipboard?.writeText(this.activeLinkData.href).catch(() => {});
    });
    this.linkEditBtn = makeBtn('edit', 'Edit Link', () => {
      const data = this.activeLinkData;
      if (!data) return;
      this.selectLinkData(data);
      this.callbacks.onEditLink?.(data.href);
    });
    this.linkUnlinkBtn = makeBtn('link_off', 'Unlink', () => {
      const data = this.activeLinkData;
      if (!data) return;
      this.selectLinkData(data);
      this.editor.chain().focus().extendMarkRange('link').unsetLink().run();
      this.hideLink();
    });

    popover.append(this.linkUrlLabel, this.linkOpenBtn, this.linkCopyBtn, this.linkEditBtn, this.linkUnlinkBtn);
    popover.addEventListener('pointerenter', () => clearTimeout(this.linkHideTimer));
    popover.addEventListener('pointerleave', () => this.scheduleHideLink());
    return popover;
  }

  createCodeOverlay() {
    const bar = document.createElement('div');
    bar.className = 'code-block-overlay';
    bar.hidden = true;

    this.codeLangSelect = document.createElement('select');
    this.codeLangSelect.className = 'code-lang-select';
    this.codeLangSelect.setAttribute('aria-label', 'Code Block Language');
    for (const [value, label] of codeLanguages) this.codeLangSelect.add(new Option(label, value));
    this.codeLangSelect.onchange = () => {
      if (!this.editor.isEditable || typeof this.activeCodePos !== 'number') return;
      const node = this.editor.state.doc.nodeAt(this.activeCodePos);
      if (!node || node.type.name !== 'codeBlock') return;
      this.editor.view.dispatch(
        this.editor.state.tr.setNodeMarkup(this.activeCodePos, undefined, {
          ...node.attrs,
          language: this.codeLangSelect.value || null,
        }),
      );
    };

    this.codeCopyBtn = document.createElement('button');
    this.codeCopyBtn.type = 'button';
    this.codeCopyBtn.className = 'code-copy-button';
    this.codeCopyBtn.setAttribute('aria-label', 'Copy Code Block');
    this.codeCopyBtn.onmousedown = event => event.preventDefault();
    const copyLabel = document.createElement('span');
    copyLabel.textContent = 'Copy';
    this.codeCopyLabel = copyLabel;
    this.codeCopyBtn.append(createIcon('content_copy'), copyLabel);
    this.codeCopyBtn.onclick = () => {
      if (typeof this.activeCodePos !== 'number') return;
      const node = this.editor.state.doc.nodeAt(this.activeCodePos);
      if (!node) return;
      navigator.clipboard?.writeText(node.textContent || '').catch(() => {});
      this.codeCopyLabel.textContent = 'Copied';
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => { this.codeCopyLabel.textContent = 'Copy'; }, 1200);
    };

    bar.append(this.codeLangSelect, this.codeCopyBtn);
    bar.addEventListener('pointerenter', () => clearTimeout(this.codeHideTimer));
    bar.addEventListener('pointerleave', () => this.scheduleHideCode());
    return bar;
  }

  createImageOverlay() {
    const pill = document.createElement('div');
    pill.className = 'image-pill';
    pill.setAttribute('role', 'toolbar');
    pill.setAttribute('aria-label', 'Image Actions');
    pill.hidden = true;

    this.imageStatus = document.createElement('span');
    this.imageStatus.className = 'image-pill-status';

    const makeBtn = (icon, label, action) => {
      const button = document.createElement('button');
      button.type = 'button';
      setButtonIcon(button, icon, label);
      button.onmousedown = event => event.preventDefault();
      button.onclick = action;
      return button;
    };

    this.imageEditBtn = makeBtn('edit', 'Edit Image', () => {
      if (typeof this.activeImagePos !== 'number') return;
      const node = this.editor.state.doc.nodeAt(this.activeImagePos);
      if (!node || node.type.name !== 'image') return;
      this.callbacks.onEditImage?.({
        pos: this.activeImagePos,
        src: node.attrs.src || '',
        alt: node.attrs.alt || '',
      });
    });
    this.imageCopyBtn = makeBtn('content_copy', 'Copy Image URL', () => {
      if (typeof this.activeImagePos !== 'number') return;
      const node = this.editor.state.doc.nodeAt(this.activeImagePos);
      if (node?.attrs.src) navigator.clipboard?.writeText(node.attrs.src).catch(() => {});
    });
    this.imageDeleteBtn = makeBtn('delete', 'Delete Image', () => {
      if (typeof this.activeImagePos !== 'number' || !this.editor.isEditable) return;
      const node = this.editor.state.doc.nodeAt(this.activeImagePos);
      if (!node || node.type.name !== 'image') return;
      this.editor.view.dispatch(this.editor.state.tr.delete(this.activeImagePos, this.activeImagePos + node.nodeSize));
      this.hideImage();
      this.editor.commands.focus();
    });

    pill.append(this.imageStatus, this.imageEditBtn, this.imageCopyBtn, this.imageDeleteBtn);
    pill.addEventListener('pointerenter', () => clearTimeout(this.imageHideTimer));
    pill.addEventListener('pointerleave', () => this.scheduleHideImage());
    return pill;
  }

  selectLinkData(data) {
    if (typeof data.from === 'number') {
      this.editor.chain().focus().setTextSelection(Math.min(data.from + 1, this.editor.state.doc.content.size)).extendMarkRange('link').run();
    } else {
      this.editor.chain().focus().extendMarkRange('link').run();
    }
  }

  scheduleHideLink() {
    clearTimeout(this.linkHideTimer);
    this.linkHideTimer = setTimeout(() => {
      if (!this.linkPopover.matches(':hover')) {
        this.hoveredLink = null;
        this.updateLinkPopover();
      }
    }, 150);
  }

  scheduleHideCode() {
    clearTimeout(this.codeHideTimer);
    this.codeHideTimer = setTimeout(() => {
      if (!this.codeOverlay.matches(':hover') && !this.codeOverlay.contains(document.activeElement)) {
        this.hoveredCodePre = null;
        this.updateCodeOverlay();
      }
    }, 150);
  }

  scheduleHideImage() {
    clearTimeout(this.imageHideTimer);
    this.imageHideTimer = setTimeout(() => {
      if (!this.imageOverlay.matches(':hover')) {
        this.hoveredImage = null;
        this.updateImageOverlay();
      }
    }, 150);
  }

  pointerMove(event) {
    if (this.editor.isDestroyed) { this.hideAll(); return; }
    const hostRect = this.host.getBoundingClientRect();
    const inHost = event.clientX >= hostRect.left && event.clientX <= hostRect.right && event.clientY >= hostRect.top && event.clientY <= hostRect.bottom;

    const anchor = inHost ? event.target.closest?.('.tiptap a') : null;
    const pre = inHost ? event.target.closest?.('.tiptap pre') : null;
    const rawImg = inHost ? event.target.closest?.('.tiptap img') : null;
    const img = rawImg && !rawImg.classList.contains('ProseMirror-separator') ? rawImg : null;
    const inTable = inHost && Boolean(event.target.closest?.('.tiptap table'));

    if (anchor) {
      clearTimeout(this.linkHideTimer);
      if (this.hoveredLink !== anchor) {
        this.hoveredLink = anchor;
        this.updateLinkPopover();
      }
    } else if (this.hoveredLink && !this.linkPopover.contains(event.target)) {
      if (pre || img || inTable || !inHost) {
        this.hoveredLink = null;
        this.updateLinkPopover();
      } else this.scheduleHideLink();
    }

    if (pre) {
      clearTimeout(this.codeHideTimer);
      if (this.hoveredCodePre !== pre) {
        this.hoveredCodePre = pre;
        this.updateCodeOverlay();
      }
    } else if (this.hoveredCodePre && !this.codeOverlay.contains(event.target)) {
      if (anchor || img || inTable || !inHost) {
        this.hoveredCodePre = null;
        this.updateCodeOverlay();
      } else this.scheduleHideCode();
    }

    if (img) {
      clearTimeout(this.imageHideTimer);
      if (this.hoveredImage !== img) {
        this.hoveredImage = img;
        this.updateImageOverlay();
      }
    } else if (this.hoveredImage && !this.imageOverlay.contains(event.target)) {
      if (anchor || pre || inTable || !inHost) {
        this.hoveredImage = null;
        this.updateImageOverlay();
      } else this.scheduleHideImage();
    }
  }

  update() {
    if (this.editor.isDestroyed) { this.hideAll(); return; }
    this.updateLinkPopover();
    this.updateCodeOverlay();
    this.updateImageOverlay();
  }

  findCodeBlockPos(pre) {
    try {
      const inside = this.editor.view.posAtDOM(pre, 0);
      const resolved = this.editor.state.doc.resolve(inside);
      for (let depth = resolved.depth; depth > 0; depth--) {
        if (resolved.node(depth).type.name === 'codeBlock') return resolved.before(depth);
      }
      if (this.editor.state.doc.nodeAt(inside)?.type.name === 'codeBlock') return inside;
      if (inside > 0 && this.editor.state.doc.nodeAt(inside - 1)?.type.name === 'codeBlock') return inside - 1;
    } catch { /* detached pre */ }
    return null;
  }

  findImagePos(img) {
    try {
      const pos = this.editor.view.posAtDOM(img, 0);
      for (const candidate of [pos, pos - 1, pos + 1]) {
        if (candidate >= 0 && this.editor.state.doc.nodeAt(candidate)?.type.name === 'image') return candidate;
      }
    } catch { /* detached img */ }
    return null;
  }

  findSelectedLinkAnchor(selection) {
    try {
      for (const pos of [selection.from, Math.min(selection.from + 1, selection.to)]) {
        const info = this.editor.view.domAtPos(pos);
        const raw = info.node instanceof Element ? (info.node.childNodes[info.offset] || info.node) : info.node;
        const element = raw instanceof Element ? raw : raw?.parentElement;
        const anchor = element?.closest?.('a');
        if (anchor && this.host.contains(anchor)) return anchor;
      }
    } catch { /* ignore detached selection */ }
    return null;
  }

  updateLinkPopover() {
    const openBlockMenu = document.querySelector('.block-menu:not([hidden])');
    if (openBlockMenu) { this.hideLink(); return; }
    let anchorRect = null;
    let href = '';
    let from = null;

    if (this.hoveredLink?.isConnected) {
      href = this.hoveredLink.getAttribute('href') || '';
      anchorRect = this.hoveredLink.getBoundingClientRect();
      try { from = this.editor.view.posAtDOM(this.hoveredLink, 0); } catch { from = null; }
    } else if (this.editor.isActive('link') && (this.editor.view.hasFocus() || this.linkPopover.contains(document.activeElement))) {
      href = this.editor.getAttributes('link').href || '';
      const selection = this.editor.state.selection;
      const anchor = this.findSelectedLinkAnchor(selection);
      if (anchor) {
        anchorRect = anchor.getBoundingClientRect();
      } else {
        const coords = this.editor.view.coordsAtPos(selection.from);
        anchorRect = { left: coords.left, right: coords.right + 40, top: coords.top, bottom: coords.bottom };
      }
    }

    if (!href || !anchorRect) { this.hideLink(); return; }
    const hostRect = this.host.getBoundingClientRect();
    if (hostRect.height < 24 || hostRect.width < 100 || anchorRect.bottom < hostRect.top || anchorRect.top > hostRect.bottom) { this.hideLink(); return; }

    this.activeLinkData = { href, from };
    this.linkUrlLabel.textContent = href;
    this.linkUrlLabel.title = href;
    this.linkEditBtn.disabled = !this.editor.isEditable;
    this.linkUnlinkBtn.disabled = !this.editor.isEditable;
    this.linkPopover.hidden = false;
    const width = this.linkPopover.offsetWidth || 260;
    const height = this.linkPopover.offsetHeight || 34;
    const maxRight = Math.min(window.innerWidth - 8, hostRect.right - 6);
    const left = Math.max(hostRect.left + 6, Math.min(anchorRect.left, maxRight - width));
    const belowTop = anchorRect.bottom + 8;
    const top = belowTop + height <= Math.min(window.innerHeight - 8, hostRect.bottom) ? belowTop : Math.max(hostRect.top + 4, anchorRect.top - height - 8);
    this.linkPopover.style.left = `${Math.round(left)}px`;
    this.linkPopover.style.top = `${Math.round(top)}px`;
  }

  updateCodeOverlay() {
    let pre = null;
    let pos = null;
    if (this.hoveredCodePre?.isConnected) {
      pre = this.hoveredCodePre;
      pos = this.findCodeBlockPos(pre);
    } else {
      const { selection } = this.editor.state;
      if (selection.$from.parent.type.name === 'codeBlock' && (this.editor.view.hasFocus() || this.codeOverlay.contains(document.activeElement))) {
        pos = selection.$from.before();
        const dom = this.editor.view.nodeDOM(pos);
        if (dom instanceof Element) pre = dom.matches('pre') ? dom : dom.querySelector('pre');
      }
    }
    if (!pre || typeof pos !== 'number') { this.hideCode(); return; }
    const node = this.editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'codeBlock') { this.hideCode(); return; }

    const rect = pre.getBoundingClientRect();
    const hostRect = this.host.getBoundingClientRect();
    if (hostRect.height < 24 || hostRect.width < 100 || rect.bottom < hostRect.top || rect.top > hostRect.bottom || rect.height === 0) { this.hideCode(); return; }

    this.activeCodePos = pos;
    const lang = node.attrs.language || '';
    for (const option of this.codeLangSelect.querySelectorAll('[data-custom]')) option.remove();
    if (lang && !codeLanguages.some(([value]) => value === lang)) {
      const custom = new Option(lang, lang);
      custom.dataset.custom = 'true';
      this.codeLangSelect.add(custom);
    }
    this.codeLangSelect.value = lang;
    this.codeLangSelect.disabled = !this.editor.isEditable;
    this.codeOverlay.hidden = false;
    const width = this.codeOverlay.offsetWidth || 165;
    const maxRight = Math.min(window.innerWidth - 8, hostRect.right - 6);
    const left = Math.max(hostRect.left + 8, Math.min(rect.right - width - 6, maxRight - width));
    const top = Math.max(hostRect.top + 4, rect.top + 4);
    this.codeOverlay.style.left = `${Math.round(left)}px`;
    this.codeOverlay.style.top = `${Math.round(top)}px`;
  }

  updateImageOverlay() {
    let img = null;
    let pos = null;
    const selection = this.editor.state.selection;
    if (this.hoveredImage?.isConnected) {
      img = this.hoveredImage;
      pos = this.findImagePos(img);
    } else if (selection.node?.type.name === 'image') {
      pos = selection.from;
      const dom = this.editor.view.nodeDOM(pos);
      img = dom instanceof Element ? (dom.tagName === 'IMG' ? dom : dom.querySelector('img')) : null;
    }
    if (!img || typeof pos !== 'number') { this.hideImage(); return; }
    const node = this.editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'image') { this.hideImage(); return; }

    const rect = img.getBoundingClientRect();
    const hostRect = this.host.getBoundingClientRect();
    if (hostRect.height < 24 || hostRect.width < 100 || rect.bottom < hostRect.top || rect.top > hostRect.bottom) { this.hideImage(); return; }

    this.activeImagePos = pos;
    const broken = img.dataset.broken === 'true' || (img.complete && img.naturalWidth === 0 && Boolean(node.attrs.src));
    this.imageStatus.textContent = broken ? 'Broken Image' : (node.attrs.alt || 'No Alt Text');
    this.imageStatus.classList.toggle('broken', broken);
    this.imageEditBtn.disabled = !this.editor.isEditable;
    this.imageDeleteBtn.disabled = !this.editor.isEditable;
    this.imageOverlay.hidden = false;
    const width = this.imageOverlay.offsetWidth || 200;
    const height = this.imageOverlay.offsetHeight || 34;
    const maxRight = Math.min(window.innerWidth - 8, hostRect.right - 6);
    const left = Math.max(hostRect.left + 6, Math.min(rect.left, maxRight - width));
    const aboveTop = rect.top - height - 6;
    const belowTop = rect.bottom + 6;
    const top = aboveTop >= hostRect.top + 4 ? aboveTop : Math.min(hostRect.bottom - height - 6, belowTop);
    this.imageOverlay.style.left = `${Math.round(left)}px`;
    this.imageOverlay.style.top = `${Math.round(top)}px`;
  }

  hideLink() { this.activeLinkData = null; this.linkPopover.hidden = true; }
  hideCode() { this.activeCodePos = null; this.codeOverlay.hidden = true; }
  hideImage() { this.activeImagePos = null; this.imageOverlay.hidden = true; }
  hideAll() { this.hideLink(); this.hideCode(); this.hideImage(); }

  destroy() {
    this.resizeObserver?.disconnect();
    clearTimeout(this.linkHideTimer);
    clearTimeout(this.codeHideTimer);
    clearTimeout(this.imageHideTimer);
    clearTimeout(this.copiedTimer);
    this.editor.off('selectionUpdate', this.boundTransaction);
    this.editor.off('transaction', this.boundTransaction);
    document.removeEventListener('pointermove', this.boundMove);
    this.host.removeEventListener('scroll', this.boundScroll);
    window.removeEventListener('resize', this.boundScroll);
    document.removeEventListener('keydown', this.boundKey, true);
    this.host.removeEventListener('error', this.boundMediaError, true);
    this.host.removeEventListener('load', this.boundMediaLoad, true);
    this.linkPopover.remove();
    this.codeOverlay.remove();
    this.imageOverlay.remove();
  }
}
