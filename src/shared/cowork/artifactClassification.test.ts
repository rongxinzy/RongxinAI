import { expect, test } from 'vitest';
import { CoworkArtifactRole } from './artifacts';
import { collectSessionArtifactCandidates } from '../../main/coworkArtifactCollector';
import { parseCodeBlockArtifacts } from '../../renderer/services/artifactParser';

test('unsupported preceding fences do not split persistent and live artifact identities', () => {
  const content = '```python\nprint(1)\n```\n```csv\na,b\n1,2\n```';
  const [persistent] = collectSessionArtifactCandidates([
    { id: 'message', type: 'assistant', content, timestamp: 1, sequence: 1 },
  ]);
  const [live] = parseCodeBlockArtifacts(content, 'message', 'session');
  expect(persistent.artifact.id).toBe(live.id);
});

test.each(['csv', 'tsv', 'html', 'jsx', 'stl'])(
  'persistent and live %s previews agree on type, language and ordinary fragment role',
  language => {
    const content = `\`\`\`${language}\na,b\n1,2\n\`\`\``;
    const [persistent] = collectSessionArtifactCandidates([
      { id: 'message', type: 'assistant', content, timestamp: 1, sequence: 1 },
    ]);
    const [live] = parseCodeBlockArtifacts(content, 'message', 'session');
    expect(persistent.artifact.type).toBe(live.type);
    expect(persistent.artifact.language).toBe(live.language);
    expect(persistent.artifact.role).toBe(CoworkArtifactRole.Intermediate);
    expect(live.role).toBe(CoworkArtifactRole.Intermediate);
  },
);

test.each(['csv', 'tsv'])(
  'explicit %s inline previews remain document candidates with table language',
  language => {
    const content = `\`\`\`artifact:${language}\na,b\n1,2\n\`\`\``;
    const [persistent] = collectSessionArtifactCandidates([
      { id: 'message', type: 'assistant', content, timestamp: 1, sequence: 1 },
    ]);
    const [live] = parseCodeBlockArtifacts(content, 'message', 'session');
    expect(persistent.artifact).toMatchObject({
      type: 'document',
      language,
      role: CoworkArtifactRole.Deliverable,
    });
    expect(live).toMatchObject({
      type: 'document',
      language,
      role: CoworkArtifactRole.Deliverable,
    });
  },
);
