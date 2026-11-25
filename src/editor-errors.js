// ==> Section 1 - Coded Editor Fallback Errors <==
// When a document cannot open in Visual or Hybrid, the editor falls back to Source and shows
// one of these codes. The table is documented in docs/ERRORS.md; add new codes at the end,
// never renumber existing ones.

const REASONS = {
  marks: { number: '001', reason: 'incompatible inline formatting' },
  html: { number: '002', reason: 'unsupported or unfinished HTML' },
  reference: { number: '003', reason: 'reference link definitions' },
  frontmatter: { number: '004', reason: 'invalid YAML front matter' },
  schema: { number: '005', reason: 'unsupported document structure' },
  unknown: { number: '099', reason: 'unexpected parse error' },
};

function classify(error) {
  if (error?.parseKind && REASONS[error.parseKind]) return error.parseKind;
  const message = error?.message || '';
  if (/^Invalid YAML|Document properties must be a YAML mapping/.test(message)) return 'frontmatter';
  if (/Invalid collection of marks/.test(message)) return 'marks';
  if (/Unsupported or unfinished HTML/.test(message)) return 'html';
  if (/Reference definitions/.test(message)) return 'reference';
  return 'unknown';
}

// "bold,code" from ProseMirror's mark error becomes "bold + code".
function markDetail(message) {
  const match = /Invalid collection of marks for node \w+: ([\w,]+)/.exec(message || '');
  return match ? match[1].split(',').join(' + ') : '';
}

export function describeEditorFallback(error, mode, lineOffset = 0) {
  const kind = classify(error);
  const { number, reason } = REASONS[kind];
  const code = `MBB-${mode === 'hybrid' ? 'HYBRID' : 'VISUAL'}-${number}`;
  const line = error?.line ? error.line + lineOffset : null;
  const detail = kind === 'marks' ? markDetail(error?.message) : '';
  const where = line ? ` at line ${line}` : '';
  const what = detail ? `: ${detail}` : '';
  const modeLabel = mode === 'hybrid' ? 'Hybrid' : 'Visual';
  return {
    code, line, kind,
    message: `${modeLabel} mode can't open this document (${code}: ${reason}${where}${what}). Source view keeps it unchanged.`,
  };
}
