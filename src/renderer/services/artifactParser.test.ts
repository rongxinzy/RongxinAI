import { describe, expect, test } from 'vitest';

import {
  normalizeFilePathForDedup,
  detectArtifactsFromMessages,
  parseDeclareArtifactFromMessages,
  parseToolArtifact,
} from './artifactParser';
import { ArtifactRole } from '../types/artifact';

describe('normalizeFilePathForDedup', () => {
  test('strips leading / before Windows drive letter', () => {
    expect(normalizeFilePathForDedup('/D:/path/file.html')).toBe('d:/path/file.html');
  });

  test('normalizes backslashes to forward slashes', () => {
    expect(normalizeFilePathForDedup('D:\\path\\file.html')).toBe('d:/path/file.html');
  });

  test('lowercases for case-insensitive comparison', () => {
    expect(normalizeFilePathForDedup('D:/Path/File.HTML')).toBe('d:/path/file.html');
  });

  test('handles Unix absolute paths unchanged (except lowercase)', () => {
    expect(normalizeFilePathForDedup('/home/user/file.html')).toBe('/home/user/file.html');
  });

  test('dedup matches: file:// derived path vs tool path', () => {
    const fromFileUrl = '/D:/new_ws_test_2/hello-slide.html';
    const fromTool = 'D:\\new_ws_test_2\\hello-slide.html';
    expect(normalizeFilePathForDedup(fromFileUrl)).toBe(normalizeFilePathForDedup(fromTool));
  });
});

describe('parseDeclareArtifactFromMessages', () => {
  const sessId = 'sess-declare';
  const defaultRole = () => ArtifactRole.Deliverable;

  test('extracts artifact from declare_artifact tool_use message', () => {
    const messages = [
      {
        id: 'tool-1',
        type: 'tool_use' as const,
        content: '',
        timestamp: Date.now(),
        metadata: {
          toolName: 'declare_artifact',
          toolInput: {
            filePath: 'D:/workspace/report.pptx',
            title: 'Final Report',
            kind: 'document',
            role: 'deliverable',
          },
        },
      },
    ];
    const artifacts = parseDeclareArtifactFromMessages(messages, sessId, defaultRole);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('D:/workspace/report.pptx');
    expect(artifacts[0].title).toBe('Final Report');
    expect(artifacts[0].type).toBe('document');
    expect(artifacts[0].role).toBe(ArtifactRole.Deliverable);
  });

  test('defaults title to fileName when no title provided', () => {
    const messages = [
      {
        id: 'tool-1',
        type: 'tool_use' as const,
        content: '',
        timestamp: Date.now(),
        metadata: {
          toolName: 'declare_artifact',
          toolInput: { filePath: '/home/user/code.ts' },
        },
      },
    ];
    const artifacts = parseDeclareArtifactFromMessages(messages, sessId, defaultRole);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe('code.ts');
    expect(artifacts[0].role).toBe(ArtifactRole.Deliverable);
  });

  test('infers type from file extension when kind not specified', () => {
    const messages = [
      {
        id: 'tool-1',
        type: 'tool_use' as const,
        content: '',
        timestamp: Date.now(),
        metadata: {
          toolName: 'declare_artifact',
          toolInput: { filePath: 'D:/workspace/output.html' },
        },
      },
    ];
    const artifacts = parseDeclareArtifactFromMessages(messages, sessId, defaultRole);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe('html');
  });

  test('respects intermediate role', () => {
    const messages = [
      {
        id: 'tool-1',
        type: 'tool_use' as const,
        content: '',
        timestamp: Date.now(),
        metadata: {
          toolName: 'declare_artifact',
          toolInput: { filePath: 'D:/workspace/draft.ts', role: 'intermediate' },
        },
      },
    ];
    const artifacts = parseDeclareArtifactFromMessages(messages, sessId, defaultRole);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].role).toBe(ArtifactRole.Intermediate);
  });

  test('skips non-declare_artifact tool_use messages', () => {
    const messages = [
      {
        id: 'tool-1',
        type: 'tool_use' as const,
        content: '',
        timestamp: Date.now(),
        metadata: {
          toolName: 'write_file',
          toolInput: { filePath: 'D:/workspace/other.ts' },
        },
      },
    ];
    const artifacts = parseDeclareArtifactFromMessages(messages, sessId, defaultRole);
    expect(artifacts).toHaveLength(0);
  });

  test('skips messages without filePath', () => {
    const messages = [
      {
        id: 'tool-1',
        type: 'tool_use' as const,
        content: '',
        timestamp: Date.now(),
        metadata: {
          toolName: 'declare_artifact',
          toolInput: { title: 'Missing path' },
        },
      },
    ];
    const artifacts = parseDeclareArtifactFromMessages(messages, sessId, defaultRole);
    expect(artifacts).toHaveLength(0);
  });
});

describe('parseToolArtifact', () => {
  test('extracts file path from Write tool input', () => {
    const toolUseMsg = {
      id: 'tool1',
      type: 'tool_use' as const,
      content: '',
      timestamp: Date.now(),
      metadata: {
        toolName: 'Write',
        toolUseId: 'tu1',
        toolInput: { file_path: 'D:\\workspace\\hello.html', content: '<html></html>' },
      },
    };
    const toolResultMsg = {
      id: 'result1',
      type: 'tool_result' as const,
      content: 'OK',
      timestamp: Date.now(),
      metadata: { toolUseId: 'tu1' },
    };
    const artifact = parseToolArtifact(toolUseMsg, toolResultMsg, 'sess1');
    expect(artifact).not.toBeNull();
    expect(artifact!.filePath).toBe('D:\\workspace\\hello.html');
  });
});

describe('detectArtifactsFromMessages', () => {
  test('does not treat directory listing output as artifacts', () => {
    const artifacts = detectArtifactsFromMessages(
      [
        {
          id: 'tool-result-1',
          type: 'tool_result',
          content: 'README.md\nsrc/notes.txt\npackage.json',
          timestamp: Date.now(),
        },
      ],
      'sess1',
    );

    expect(artifacts).toHaveLength(0);
  });

  test('detects code blocks as previewable code artifacts', () => {
    const artifacts = detectArtifactsFromMessages(
      [
        {
          id: 'assistant-1',
          type: 'assistant',
          content: '```tsx\nexport const App = () => <main />;\n```',
          timestamp: Date.now(),
        },
      ],
      'sess1',
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].artifact.type).toBe('code');
    expect(artifacts[0].artifact.role).toBe(ArtifactRole.Deliverable);
    expect(artifacts[0].needsFileLoad).toBe(false);
  });

  test('detects declare_artifact tool calls as file-backed artifacts', () => {
    const artifacts = detectArtifactsFromMessages(
      [
        {
          id: 'tool-1',
          type: 'tool_use' as const,
          content: '',
          timestamp: Date.now(),
          metadata: {
            toolName: 'declare_artifact',
            toolInput: {
              filePath: 'D:/workspace/presentations/slides.pptx',
              role: 'deliverable',
            },
          },
        },
      ],
      'sess1',
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].artifact.type).toBe('document');
    expect(artifacts[0].artifact.filePath).toBe('D:/workspace/presentations/slides.pptx');
    expect(artifacts[0].artifact.role).toBe(ArtifactRole.Deliverable);
    expect(artifacts[0].needsFileLoad).toBe(true);
  });

  test('does not detect bare paths in assistant messages (no regex)', () => {
    const artifacts = detectArtifactsFromMessages(
      [
        {
          id: 'assistant-1',
          type: 'assistant',
          content: 'Created D:/workspace/report.pptx',
          timestamp: Date.now(),
        },
      ],
      'sess1',
    );

    // Bare paths in prose are no longer detected — artifacts must be explicitly declared.
    expect(artifacts).toHaveLength(0);
  });

  test('does not detect file:// links in assistant messages (no regex)', () => {
    const artifacts = detectArtifactsFromMessages(
      [
        {
          id: 'assistant-1',
          type: 'assistant',
          content: '[report.pptx](file:///D:/workspace/report.pptx)',
          timestamp: Date.now(),
        },
      ],
      'sess1',
    );

    // File links are no longer regex-parsed — artifacts must be explicitly declared.
    expect(artifacts).toHaveLength(0);
  });

  test('does not detect bare paths in thinking messages', () => {
    const artifacts = detectArtifactsFromMessages(
      [
        {
          id: 'assistant-thinking-1',
          type: 'assistant',
          content: 'Creating D:/workspace/report.pptx',
          timestamp: Date.now(),
          metadata: { isThinking: true },
        },
      ],
      'sess1',
    );

    expect(artifacts).toHaveLength(0);
  });

  test('keeps explicit write-tool outputs as artifacts', () => {
    const artifacts = detectArtifactsFromMessages(
      [
        {
          id: 'tool-use-1',
          type: 'tool_use',
          content: 'Using tool: Write',
          timestamp: Date.now(),
          metadata: {
            toolName: 'Write',
            toolUseId: 'call-1',
            toolInput: {
              file_path: 'D:/workspace/output.ts',
              content: 'export const value = 1;',
            },
          },
        },
        {
          id: 'tool-result-1',
          type: 'tool_result',
          content: 'OK',
          timestamp: Date.now(),
          metadata: { toolUseId: 'call-1' },
        },
      ],
      'sess1',
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].artifact.filePath).toBe('D:/workspace/output.ts');
    expect(artifacts[0].artifact.role).toBe(ArtifactRole.Deliverable);
    expect(artifacts[0].needsFileLoad).toBe(true);
  });

  test('marks only the final answer artifact as deliverable via declare_artifact', () => {
    const artifacts = detectArtifactsFromMessages(
      [
        {
          id: 'tool-intermediate',
          type: 'tool_use' as const,
          content: '',
          timestamp: Date.now(),
          metadata: {
            toolName: 'declare_artifact',
            toolInput: {
              filePath: 'D:/workspace/slides/draft.js',
              role: 'intermediate',
            },
          },
        },
        {
          id: 'assistant-final',
          type: 'assistant',
          content: 'Done.',
          timestamp: Date.now(),
          metadata: { isFinal: true, isStreaming: false, isFinalAnswer: true },
        },
        {
          id: 'tool-deliverable',
          type: 'tool_use' as const,
          content: '',
          timestamp: Date.now(),
          metadata: {
            toolName: 'declare_artifact',
            toolInput: {
              filePath: 'D:/workspace/output/presentation.pptx',
              role: 'deliverable',
            },
          },
        },
      ],
      'sess1',
    );

    expect(artifacts).toHaveLength(2);
    expect(artifacts[0].artifact.role).toBe(ArtifactRole.Intermediate);
    expect(artifacts[1].artifact.role).toBe(ArtifactRole.Deliverable);
  });

  test('deduplicates declare_artifact with same filePath (promotes to deliverable)', () => {
    const artifacts = detectArtifactsFromMessages(
      [
        {
          id: 'tool-intermediate',
          type: 'tool_use' as const,
          content: '',
          timestamp: Date.now(),
          metadata: {
            toolName: 'declare_artifact',
            toolInput: {
              filePath: 'D:/workspace/output/build.js',
              role: 'intermediate',
            },
          },
        },
        {
          id: 'tool-deliverable',
          type: 'tool_use' as const,
          content: '',
          timestamp: Date.now(),
          metadata: {
            toolName: 'declare_artifact',
            toolInput: {
              filePath: 'D:/workspace/output/build.js',
              role: 'deliverable',
            },
          },
        },
      ],
      'sess1',
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].artifact.role).toBe(ArtifactRole.Deliverable);
  });
});
