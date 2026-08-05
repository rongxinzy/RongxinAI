import { describe, expect, test } from 'vitest';

import { CoworkArtifactRole, CoworkArtifactSource } from '../shared/cowork/artifacts';
import {
  collectSessionArtifactCandidates,
  type CoworkArtifactMessage,
} from './coworkArtifactCollector';

function message(
  id: string,
  sequence: number,
  type: string,
  content: string,
  metadata?: Record<string, unknown>,
): CoworkArtifactMessage {
  return { id, sequence, type, content, metadata, timestamp: sequence * 100 };
}

describe('collectSessionArtifactCandidates', () => {
  test('emits declarations before writes for the same normalized path', () => {
    const candidates = collectSessionArtifactCandidates([
      message('write-1', 1, 'tool_use', '', {
        toolName: 'Write',
        toolInput: { file_path: 'D:\\output\\report.html', content: '<h1>Report</h1>' },
      }),
      message('declare-1', 2, 'tool_use', '', {
        toolName: 'declare_artifact',
        toolInput: {
          filePath: 'file:///D:/output/report.html',
          title: 'Quarterly report',
          kind: 'html',
          role: CoworkArtifactRole.Intermediate,
        },
      }),
    ]);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      artifactKey: 'path:d:/output/report.html',
      artifact: {
        title: 'Quarterly report',
        declared: true,
        role: CoworkArtifactRole.Intermediate,
      },
    });
    expect(candidates[1]).toMatchObject({
      artifactKey: 'path:d:/output/report.html',
      artifact: {
        content: '',
        declared: false,
        role: CoworkArtifactRole.Intermediate,
      },
    });
  });

  test('keeps undeclared verification scripts out of deliverables', () => {
    const candidates = collectSessionArtifactCandidates([
      message('write-verification-script', 1, 'tool_use', '', {
        toolName: 'write',
        toolInput: { path: 'D:/output/_verify_tetris.js', content: 'runTests();' },
      }),
      message('declare-html', 2, 'tool_use', '', {
        toolName: 'declare_artifact',
        toolInput: {
          filePath: 'D:/output/tetris.html',
          role: CoworkArtifactRole.Deliverable,
        },
      }),
    ]);

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifact: expect.objectContaining({
            fileName: '_verify_tetris.js',
            role: CoworkArtifactRole.Intermediate,
            declared: false,
          }),
        }),
        expect.objectContaining({
          artifact: expect.objectContaining({
            fileName: 'tetris.html',
            role: CoworkArtifactRole.Deliverable,
            declared: true,
          }),
        }),
      ]),
    );
  });

  test('collects supported assistant code blocks with stable keys and content', () => {
    const [candidate] = collectSessionArtifactCandidates([
      message(
        'assistant-1',
        1,
        'assistant',
        '```artifact:html title="Preview"\n<h1>Hello</h1>\n```',
      ),
    ]);

    expect(candidate).toMatchObject({
      artifactKey: 'message:assistant-1:block:0',
      artifact: {
        id: 'artifact-assistant-1-0',
        messageId: 'assistant-1',
        type: 'html',
        title: 'Preview',
        content: '<h1>Hello</h1>',
        source: CoworkArtifactSource.CodeBlock,
      },
    });
  });

  test('ignores writes whose matching tool result failed', () => {
    const candidates = collectSessionArtifactCandidates([
      message('write-1', 1, 'tool_use', '', {
        toolName: 'write_file',
        toolUseId: 'call-1',
        toolInput: { path: 'failed.html', content: 'not written' },
      }),
      message('result-1', 2, 'tool_result', 'failed', {
        toolUseId: 'call-1',
        isError: true,
      }),
    ]);

    expect(candidates).toEqual([]);
  });
});
