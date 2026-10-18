import { describe, expect, test } from 'vitest';

import { CoworkMessageType } from '../../shared/cowork/constants';
import { ArtifactRole } from '../types/artifact';
import type { CoworkMessage } from '../types/cowork';
import { collectInlineArtifacts, parseCodeBlockArtifacts } from './inlineArtifacts';

describe('parseCodeBlockArtifacts', () => {
  test('treats csv and tsv code blocks as document previews', () => {
    const csv = parseCodeBlockArtifacts('```csv\na,b\n1,2\n```', 'message-csv', 'session');
    const tsv = parseCodeBlockArtifacts('```tsv\na\tb\n1\t2\n```', 'message-tsv', 'session');
    expect(csv[0].type).toBe('document');
    expect(tsv[0].type).toBe('document');
  });

  test('derives a deterministic id from the message and block index', () => {
    const artifacts = parseCodeBlockArtifacts(
      '```html\n<b>one</b>\n```\n```html\n<b>two</b>\n```',
      'message-1',
      'session',
    );
    expect(artifacts.map(artifact => artifact.id)).toEqual([
      'artifact-message-1-0',
      'artifact-message-1-1',
    ]);
  });

  test('keeps ordinary code blocks intermediate and explicit artifact blocks deliverable', () => {
    const [code, explicit] = parseCodeBlockArtifacts(
      '```tsx\nexport const A = () => <main />;\n```\n```artifact:html title="Slides"\n<h1>hi</h1>\n```',
      'message-1',
      'session',
    );
    expect(code.role).toBe(ArtifactRole.Intermediate);
    expect(code.source).toBe('codeblock');
    expect(explicit.role).toBe(ArtifactRole.Deliverable);
    expect(explicit.title).toBe('Slides');
    expect(explicit.content).toBe('<h1>hi</h1>');
  });
});

describe('collectInlineArtifacts', () => {
  const assistantMessage = (
    id: string,
    content: string,
    metadata?: CoworkMessage['metadata'],
  ): CoworkMessage => ({
    id,
    type: CoworkMessageType.Assistant,
    content,
    timestamp: 1,
    metadata,
  });

  test('projects inline artifacts of settled assistant messages in message order', () => {
    const artifacts = collectInlineArtifacts(
      [
        assistantMessage('m-1', '```html\n<h1>a</h1>\n```'),
        { id: 'u-1', type: CoworkMessageType.User, content: 'thanks', timestamp: 1 },
        assistantMessage('m-2', '```svg\n<svg />\n```'),
      ],
      'session',
    );
    expect(artifacts.map(artifact => artifact.id)).toEqual(['artifact-m-1-0', 'artifact-m-2-0']);
    expect(artifacts.every(artifact => artifact.sessionId === 'session')).toBe(true);
  });

  test('skips thinking and still-streaming messages', () => {
    const artifacts = collectInlineArtifacts(
      [
        assistantMessage('m-think', '```html\n<h1>draft</h1>\n```', { isThinking: true }),
        assistantMessage('m-live', '```html\n<h1>partial</h1>\n```', { isStreaming: true }),
        assistantMessage('m-final', '```html\n<h1>done</h1>\n```', { isFinalAnswer: true }),
      ],
      'session',
    );
    expect(artifacts.map(artifact => artifact.id)).toEqual(['artifact-m-final-0']);
  });

  test('never derives file artifacts from prose paths', () => {
    const artifacts = collectInlineArtifacts(
      [
        assistantMessage(
          'm-final',
          'Created D:/workspace/report.pptx — see [report](file:///D:/workspace/report.pptx).',
          { isFinalAnswer: true },
        ),
      ],
      'session',
    );
    expect(artifacts).toEqual([]);
  });
});
