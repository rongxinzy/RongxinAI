import { expect, test } from 'vitest';
import { CoworkArtifactRole } from './artifacts';
import { parseCodeBlockArtifacts } from '../../renderer/services/artifactParser';

// The persistent artifact index was removed in favor of the event-time
// ledger (file-backed artifacts) plus this single renderer parser for inline
// code blocks. These tests pin the parser contract the ledger migration
// relied on: stable identities, type/language agreement with the shared
// classification tables, and ordinary fragments staying intermediate.

test('unsupported preceding fences do not split code block artifact identities', () => {
  const content = '```python\nprint(1)\n```\n```csv\na,b\n1,2\n```';
  const first = parseCodeBlockArtifacts(content, 'message', 'session');
  const second = parseCodeBlockArtifacts(content, 'message', 'session');
  expect(first).toHaveLength(1);
  expect(first[0].id).toBe(second[0].id);
});

test.each(['csv', 'tsv', 'html', 'jsx', 'stl'])(
  '%s code blocks keep type, language and ordinary fragment role',
  language => {
    const content = `\`\`\`${language}\na,b\n1,2\n\`\`\``;
    const [artifact] = parseCodeBlockArtifacts(content, 'message', 'session');
    expect(artifact.type).toBe(
      language === 'csv' || language === 'tsv'
        ? 'document'
        : language === 'html'
          ? 'html'
          : language === 'jsx'
            ? 'code'
            : 'model',
    );
    // Inline language is kept only for code and table artifacts (see
    // getInlineArtifactLanguage); previews derive rendering from `type`.
    const keepsLanguage = language === 'csv' || language === 'tsv' || language === 'jsx';
    expect(artifact.language).toBe(keepsLanguage ? language : undefined);
    expect(artifact.role).toBe(CoworkArtifactRole.Intermediate);
  },
);

test.each(['csv', 'tsv'])('explicit %s inline previews stay document deliverables', language => {
  const content = `\`\`\`artifact:${language}\na,b\n1,2\n\`\`\``;
  const [artifact] = parseCodeBlockArtifacts(content, 'message', 'session');
  expect(artifact).toMatchObject({
    type: 'document',
    language,
    role: CoworkArtifactRole.Deliverable,
  });
});
