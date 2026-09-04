import { describe, expect, test } from 'vitest';

import { ArtifactRole } from '../types/artifact';
import type { CoworkMessage } from '../types/cowork';
import { ArtifactDetectionIndex } from './artifactDetectionIndex';

function writeMessage(overrides: Partial<CoworkMessage> = {}): CoworkMessage {
  return {
    id: 'write-message',
    type: 'tool_use',
    content: '',
    timestamp: 1,
    metadata: {
      toolName: 'write',
      toolUseId: 'call-1',
      toolInput: { path: 'C:/workspace/report.md', content: '# Report' },
    },
    ...overrides,
  };
}

function resultMessage(overrides: Partial<CoworkMessage> = {}): CoworkMessage {
  return {
    id: 'result-message',
    type: 'tool_result',
    content: 'written',
    timestamp: 2,
    metadata: { toolUseId: 'call-1' },
    ...overrides,
  };
}

describe('ArtifactDetectionIndex', () => {
  test('recomputes only the linked tool artifact when a result arrives late', () => {
    const index = new ArtifactDetectionIndex();
    index.replace([writeMessage()], 'session-1');
    expect(index.getArtifacts()).toHaveLength(1);

    index.applyPatch(
      [resultMessage()],
      [writeMessage()],
      [],
      ['write-message', 'result-message'],
      'session-1',
    );

    expect(index.getArtifacts()).toHaveLength(1);
    expect(index.getArtifacts()[0]?.artifact.filePath).toBe('C:/workspace/report.md');
  });

  test('removes a tool artifact when its result becomes an error', () => {
    const index = new ArtifactDetectionIndex();
    index.replace([writeMessage(), resultMessage()], 'session-2');
    expect(index.getArtifacts()).toHaveLength(1);

    index.applyPatch(
      [resultMessage({ metadata: { toolUseId: 'call-1', isError: true } })],
      [],
      [],
      undefined,
      'session-2',
    );

    expect(index.getArtifacts()).toEqual([]);
  });

  test('keeps declared delivery identity over a duplicate final-answer path', () => {
    const index = new ArtifactDetectionIndex();
    const finalAnswer: CoworkMessage = {
      id: 'final-answer',
      type: 'assistant',
      content: 'Saved to C:/workspace/report.md',
      timestamp: 3,
      metadata: { isFinal: true },
    };
    const declaration: CoworkMessage = {
      id: 'declaration',
      type: 'tool_use',
      content: '',
      timestamp: 4,
      metadata: {
        toolName: 'declare_artifact',
        toolInput: {
          filePath: 'C:/workspace/report.md',
          title: 'Final report',
          role: 'deliverable',
        },
      },
    };
    index.replace([finalAnswer, declaration], 'session-3');

    const artifacts = index.getArtifacts();
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.artifact).toMatchObject({
      title: 'Final report',
      declared: true,
      role: ArtifactRole.Deliverable,
    });
  });
});
