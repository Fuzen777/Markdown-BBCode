// ==> Section 1 - Dismissable Prompts <==
// Informational confirmations that offer "Don't Show This Again". Ids are stable and stored in
// session.json as preferences.dismissedPrompts { id: choice }; a dismissed prompt is skipped and
// takes the choice made when it was dismissed. Never register destructive or data-loss prompts
// (unsaved changes, missing files, conflicts, overwrites).
export const DISMISSABLE_PROMPTS = Object.freeze([
  { id: 'visual-fix-reset-undo', label: 'Fix in Visual Mode', description: 'Asked when a lint fix cannot be applied in place and Visual mode must reload, resetting undo history.', defaultChoice: 'fix' },
  { id: 'bbcode-export-notes', label: 'BBCode Export Notes', description: 'Lists formatting that Copy BBCode and Export will change or drop.', defaultChoice: 'continue' },
  { id: 'bbcode-import-notes', label: 'BBCode Import Notes', description: 'Lists BBCode an import could not convert before importing the rest.', defaultChoice: 'import' },
]);

// Accepts the current map, an older string[] of ids (each mapped to its default choice) or nothing.
export function normalizeDismissedPrompts(value) {
  const known = new Map(DISMISSABLE_PROMPTS.map(prompt => [prompt.id, prompt]));
  const result = {};
  if (Array.isArray(value)) {
    for (const id of value) if (known.has(id)) result[id] = known.get(id).defaultChoice;
    return result;
  }
  if (!value || typeof value !== 'object') return result;
  for (const [id, choice] of Object.entries(value)) {
    if (known.has(id) && typeof choice === 'string' && choice && choice !== 'cancel') result[id] = choice;
  }
  return result;
}
