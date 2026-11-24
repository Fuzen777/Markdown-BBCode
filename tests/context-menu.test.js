// ==> Section 1 - Context Menu Guard Tests <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { allowsNativeContextMenu, installContextMenuGuard } from '../src/context-menu.js';

function makeElement({
  tagName = 'DIV',
  id = '',
  classes = [],
  attrs = {},
  type = '',
  disabled = false,
  readOnly = false,
  selectionStart = 0,
  selectionEnd = 0,
  isContentEditable = false,
  parentElement = null,
} = {}) {
  const el = {
    nodeType: 1,
    tagName,
    id,
    classList: { contains: name => classes.includes(name) },
    attrs,
    type,
    disabled,
    readOnly,
    selectionStart,
    selectionEnd,
    isContentEditable,
    parentElement,
    contains(target) {
      let cur = target;
      while (cur) {
        if (cur === el) return true;
        cur = cur.parentElement || null;
      }
      return false;
    },
    closest(selector) {
      const tokens = selector.split(',').map(s => s.trim()).filter(Boolean);
      let cur = el;
      while (cur) {
        for (const token of tokens) {
          if (token.startsWith('#') && cur.id === token.slice(1)) return cur;
          if (token.startsWith('.') && cur.classList?.contains(token.slice(1))) return cur;
          if (token.startsWith('[') && token.endsWith(']')) {
            const [attr, rawVal] = token.slice(1, -1).split('=');
            const expected = rawVal?.replace(/^"|"$/g, '');
            if (cur.attrs?.[attr] === expected) return cur;
          }
          if (/^[a-z]+$/i.test(token) && cur.tagName?.toUpperCase() === token.toUpperCase()) return cur;
        }
        cur = cur.parentElement || null;
      }
      return null;
    },
  };
  return el;
}

function makeTextNode(parentElement) {
  return { nodeType: 3, parentElement };
}

test('allowsNativeContextMenu blocks UI chrome and non-text inputs', () => {
  const header = makeElement({ tagName: 'HEADER' });
  const saveButton = makeElement({ tagName: 'BUTTON', id: 'save', parentElement: header });
  const select = makeElement({ tagName: 'SELECT', id: 'heading' });
  const rangeInput = makeElement({ tagName: 'INPUT', type: 'range' });
  const checkbox = makeElement({ tagName: 'INPUT', type: 'checkbox' });
  const disabledText = makeElement({ tagName: 'INPUT', type: 'text', disabled: true });
  const disabledTextarea = makeElement({ tagName: 'TEXTAREA', disabled: true });
  const gutter = makeElement({ tagName: 'DIV', classes: ['block-gutter'] });
  const gutterBtn = makeElement({ tagName: 'SPAN', parentElement: gutter });
  const hybridGutter = makeElement({ tagName: 'DIV', classes: ['hybrid-gutter'] });
  const diffGutter = makeElement({ tagName: 'DIV', classes: ['diff-gutter'] });
  const diffSign = makeElement({ tagName: 'SPAN', classes: ['diff-sign'] });
  const menu = makeElement({ tagName: 'DIV', attrs: { role: 'menu' } });
  const plainDiv = makeElement({ tagName: 'DIV' });

  for (const target of [
    null,
    header,
    saveButton,
    makeTextNode(saveButton),
    select,
    rangeInput,
    checkbox,
    disabledText,
    disabledTextarea,
    gutter,
    gutterBtn,
    hybridGutter,
    diffGutter,
    diffSign,
    menu,
    plainDiv,
  ]) {
    assert.equal(allowsNativeContextMenu(target, null), false);
  }
});

test('allowsNativeContextMenu allows editable inputs, textareas, and contentEditable text', () => {
  const textarea = makeElement({ tagName: 'TEXTAREA' });
  const textInput = makeElement({ tagName: 'INPUT', type: 'text' });
  const defaultInput = makeElement({ tagName: 'INPUT' });
  const numberInput = makeElement({ tagName: 'INPUT', type: 'number' });
  const tiptap = makeElement({ tagName: 'DIV', classes: ['tiptap'], isContentEditable: true });
  const paragraph = makeElement({ tagName: 'P', isContentEditable: true, parentElement: tiptap });
  const cmContent = makeElement({ tagName: 'DIV', classes: ['cm-content'], isContentEditable: true });

  assert.equal(allowsNativeContextMenu(textarea, null), true);
  assert.equal(allowsNativeContextMenu(textInput, null), true);
  assert.equal(allowsNativeContextMenu(defaultInput, null), true);
  assert.equal(allowsNativeContextMenu(numberInput, null), true);
  assert.equal(allowsNativeContextMenu(paragraph, null), true);
  assert.equal(allowsNativeContextMenu(makeTextNode(paragraph), null), true);
  assert.equal(allowsNativeContextMenu(cmContent, null), true);

  // Controls inside editable containers remain suppressed, while callout title text input stays allowed.
  const calloutHeader = makeElement({ tagName: 'DIV', classes: ['callout-title'], parentElement: tiptap });
  const calloutButton = makeElement({ tagName: 'BUTTON', isContentEditable: false, parentElement: calloutHeader });
  const calloutSelect = makeElement({ tagName: 'SELECT', isContentEditable: false, parentElement: calloutHeader });
  const calloutTitleInput = makeElement({ tagName: 'INPUT', type: 'text', parentElement: calloutHeader });
  assert.equal(allowsNativeContextMenu(calloutHeader, null), false);
  assert.equal(allowsNativeContextMenu(calloutButton, null), false);
  assert.equal(allowsNativeContextMenu(calloutSelect, null), false);
  assert.equal(allowsNativeContextMenu(calloutTitleInput, null), true);
});

test('allowsNativeContextMenu respects read-only selection rules', () => {
  const roTextareaEmpty = makeElement({ tagName: 'TEXTAREA', readOnly: true, selectionStart: 3, selectionEnd: 3 });
  const roTextareaSelected = makeElement({ tagName: 'TEXTAREA', readOnly: true, selectionStart: 0, selectionEnd: 5 });
  const roInputEmpty = makeElement({ tagName: 'INPUT', type: 'text', readOnly: true, selectionStart: 1, selectionEnd: 1 });
  const roInputSelected = makeElement({ tagName: 'INPUT', type: 'text', readOnly: true, selectionStart: 1, selectionEnd: 4 });

  assert.equal(allowsNativeContextMenu(roTextareaEmpty, null), false);
  assert.equal(allowsNativeContextMenu(roTextareaSelected, null), true);
  assert.equal(allowsNativeContextMenu(roInputEmpty, null), false);
  assert.equal(allowsNativeContextMenu(roInputSelected, null), true);

  const hybrid = makeElement({ tagName: 'DIV', id: 'hybrid-editor' });
  const inactiveBlock = makeElement({ tagName: 'DIV', parentElement: hybrid });
  const inactiveText = makeTextNode(inactiveBlock);
  const diffBody = makeElement({ tagName: 'DIV', id: 'diff-view-body' });
  const diffLine = makeElement({ tagName: 'SPAN', parentElement: diffBody });
  const outsideNode = makeTextNode(makeElement({ tagName: 'P' }));

  const collapsedSel = { isCollapsed: true, toString: () => '', anchorNode: inactiveText, focusNode: inactiveText };
  const insideHybridSel = { isCollapsed: false, toString: () => 'hello', anchorNode: inactiveText, focusNode: inactiveText };
  const outsideSel = { isCollapsed: false, toString: () => 'hello', anchorNode: outsideNode, focusNode: outsideNode };

  assert.equal(allowsNativeContextMenu(inactiveBlock, null), false);
  assert.equal(allowsNativeContextMenu(inactiveBlock, collapsedSel), false);
  assert.equal(allowsNativeContextMenu(inactiveBlock, insideHybridSel), true);
  assert.equal(allowsNativeContextMenu(diffLine, insideHybridSel), false);
  assert.equal(allowsNativeContextMenu(inactiveBlock, outsideSel), false);
});

test('installContextMenuGuard skips already defaultPrevented events and detaches cleanly', () => {
  const listeners = [];
  const doc = {
    defaultView: { getSelection: () => null },
    addEventListener(type, fn) { listeners.push({ type, fn }); },
    removeEventListener(type, fn) {
      const idx = listeners.findIndex(item => item.type === type && item.fn === fn);
      if (idx >= 0) listeners.splice(idx, 1);
    },
  };

  const detach = installContextMenuGuard(doc);
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].type, 'contextmenu');

  const chromeEvent = {
    target: makeElement({ tagName: 'BUTTON' }),
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
  listeners[0].fn(chromeEvent);
  assert.equal(chromeEvent.defaultPrevented, true);

  const editorEvent = {
    target: makeElement({ tagName: 'TEXTAREA' }),
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
  listeners[0].fn(editorEvent);
  assert.equal(editorEvent.defaultPrevented, false);

  let preventCalls = 0;
  const customHandledEvent = {
    target: makeElement({ tagName: 'DIV' }),
    defaultPrevented: true,
    preventDefault() { preventCalls += 1; },
  };
  listeners[0].fn(customHandledEvent);
  assert.equal(preventCalls, 0);

  detach();
  assert.equal(listeners.length, 0);
});
