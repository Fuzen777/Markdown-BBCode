// ==> Section 1 - Virtual Key Shortcut Resolution <==

/**
 * Resolves a shortcut letter from Windows virtual-key codes (VK_A-VK_Z) first
 * so split Ctrl layouts like BÉPO azerty-ctrl match intended shortcut keys.
 */
export function shortcutKey(event) {
  if (typeof event.keyCode === 'number' && event.keyCode >= 65 && event.keyCode <= 90) {
    return String.fromCharCode(event.keyCode + 32);
  }
  return typeof event.key === 'string' ? event.key.toLowerCase() : '';
}

/**
 * Returns true when a Ctrl/Meta chord without Alt reports a different printable
 * event.key than its Windows VK_A-VK_Z virtual key (avoiding editor misfires).
 */
export function isMismatchedCtrlLetter(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
  if (typeof event.keyCode !== 'number' || event.keyCode < 65 || event.keyCode > 90) return false;
  return (typeof event.key === 'string' ? event.key.toLowerCase() : '') !== String.fromCharCode(event.keyCode + 32);
}
