// ==> Section 1 - Shared Toast Stack <==
// One stack per app, bottom right. The newest toast lands at the bottom. Hovering any toast pauses every timer.
// Clicking a toast dismisses it; its own buttons run their action and then dismiss it.
import { createIcon, setButtonIcon } from './icons.js';

const DEFAULT_DURATION_MS = 5000;
const ACTION_DURATION_MS = 10000;

let stack = null;
let paused = false;
const activeToasts = new Set();

function ensureStack() {
  if (stack) return stack;
  stack = document.createElement('div');
  stack.id = 'toast-stack';
  stack.setAttribute('aria-live', 'polite');
  stack.onpointerenter = () => {
    paused = true;
    for (const toast of activeToasts) toast.pause();
  };
  stack.onpointerleave = () => {
    paused = false;
    for (const toast of activeToasts) toast.resume();
  };
  document.body.append(stack);
  return stack;
}

/**
 * Shows a toast. tone: info | success | warning | error. action: { label, run } adds a button.
 * Returns { dismiss } so callers can remove it early.
 */
export function showToast({ title, body = '', tone = 'info', action = null, duration } = {}) {
  const container = ensureStack();
  const toast = document.createElement('div');
  toast.className = `toast toast-${tone}`;
  if (tone === 'error') toast.setAttribute('role', 'alert');
  // The local icon set has one status glyph; the tone colors it.
  const icon = createIcon('info');
  icon.classList.add('toast-icon');
  const text = document.createElement('div');
  text.className = 'toast-text';
  const heading = document.createElement('div');
  heading.className = 'toast-title';
  heading.textContent = title;
  text.append(heading);
  if (body) {
    const detail = document.createElement('div');
    detail.className = 'toast-body';
    detail.textContent = body;
    text.append(detail);
  }
  toast.append(icon, text);

  let remaining = duration ?? (action ? ACTION_DURATION_MS : DEFAULT_DURATION_MS);
  let startedAt = 0;
  let timer = null;
  const entry = {
    pause() {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      remaining -= Date.now() - startedAt;
    },
    resume() {
      if (timer || !toast.isConnected) return;
      startedAt = Date.now();
      timer = setTimeout(dismiss, Math.max(0, remaining));
    },
  };
  function dismiss() {
    clearTimeout(timer);
    timer = null;
    activeToasts.delete(entry);
    toast.remove();
    // A toast removed under the pointer never fires pointerleave, so unpause once the stack is empty.
    if (!activeToasts.size) paused = false;
  }

  if (action) {
    const actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.className = 'toast-action';
    actionButton.textContent = action.label;
    actionButton.onclick = event => {
      event.stopPropagation();
      dismiss();
      void action.run();
    };
    toast.append(actionButton);
  }
  const dismissButton = document.createElement('button');
  dismissButton.type = 'button';
  dismissButton.className = 'toast-dismiss';
  setButtonIcon(dismissButton, 'close', 'Dismiss');
  dismissButton.onclick = event => { event.stopPropagation(); dismiss(); };
  toast.append(dismissButton);
  toast.onclick = dismiss;

  container.append(toast);
  activeToasts.add(entry);
  if (!paused) entry.resume();
  return { dismiss };
}
