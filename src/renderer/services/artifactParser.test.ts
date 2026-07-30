import { describe, expect, test } from 'vitest';

import {
  normalizeFilePathForDedup,
  detectArtifactsFromMessages,
  parseFileLinksFromMessage,
  parseFilePathsFromText,
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

describe('parseFileLinksFromMessage', () => {
  test('strips leading / from Windows file:// link path', () => {
    const content = '文件：[hello.pptx](file:///D:/workspace/hello.pptx)';
    const artifacts = parseFileLinksFromMessage(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('D:/workspace/hello.pptx');
  });

  test('preserves Unix file:// link path', () => {
    const content = '[report.pdf](file:///home/user/report.pdf)';
    const artifacts = parseFileLinksFromMessage(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('/home/user/report.pdf');
  });

  test('handles URI-encoded paths', () => {
    const content = '[文件.pptx](file:///D:/my%20folder/%E6%96%87%E4%BB%B6.pptx)';
    const artifacts = parseFileLinksFromMessage(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('D:/my folder/文件.pptx');
  });
});

describe('parseFilePathsFromText', () => {
  test('strips leading / after file:/// protocol removal on Windows', () => {
    const content = 'output at file:///D:/project/output.pdf done';
    const artifacts = parseFilePathsFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('D:/project/output.pdf');
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

  test('dedup: tool path and file link path normalize to same value', () => {
    const toolPath = 'D:\\new_ws_test_2\\hello-slide.pptx';
    const linkContent = '[hello-slide.pptx](file:///D:/new_ws_test_2/hello-slide.pptx)';
    const linkArtifacts = parseFileLinksFromMessage(linkContent, 'msg1', 'sess1');
    expect(linkArtifacts).toHaveLength(1);

    expect(normalizeFilePathForDedup(toolPath)).toBe(
      normalizeFilePathForDedup(linkArtifacts[0].filePath!),
    );
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

  test('detects bare Windows PPTX paths in assistant messages', () => {
    const artifacts = detectArtifactsFromMessages(
      [
        {
          id: 'assistant-1',
          type: 'assistant',
          content: 'Created D:/workspace/presentations/刘德华_AndyLau.pptx',
          timestamp: Date.now(),
        },
      ],
      'sess1',
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].artifact.type).toBe('document');
    expect(artifacts[0].artifact.filePath).toBe('D:/workspace/presentations/刘德华_AndyLau.pptx');
    expect(artifacts[0].needsFileLoad).toBe(true);
  });

  test('detects bare POSIX PPTX paths in assistant messages', () => {
    const artifacts = detectArtifactsFromMessages(
      [
        {
          id: 'assistant-1',
          type: 'assistant',
          content: 'Created /home/user/presentations/report.pptx',
          timestamp: Date.now(),
        },
      ],
      'sess1',
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].artifact.filePath).toBe('/home/user/presentations/report.pptx');
  });

  test('deduplicates file links against their embedded paths', () => {
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

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].artifact.filePath).toBe('D:/workspace/report.pptx');
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
    expect(artifacts[0].artifact.role).toBe(ArtifactRole.Intermediate);
    expect(artifacts[0].needsFileLoad).toBe(true);
  });

  test('marks only the final answer file path as a deliverable', () => {
    const artifacts = detectArtifactsFromMessages(
      [
        {
          id: 'assistant-progress',
          type: 'assistant',
          content: 'Working file: D:/workspace/slides/slide-01.js',
          timestamp: Date.now(),
          metadata: { isFinal: true, isStreaming: false },
        },
        {
          id: 'assistant-final',
          type: 'assistant',
          content: 'Final file: D:/workspace/output/presentation.pptx',
          timestamp: Date.now(),
          metadata: { isFinal: true, isStreaming: false, isFinalAnswer: true },
        },
      ],
      'sess1',
    );

    expect(artifacts).toHaveLength(2);
    expect(artifacts[0].artifact.role).toBe(ArtifactRole.Intermediate);
    expect(artifacts[1].artifact.role).toBe(ArtifactRole.Deliverable);
  });

  test('promotes a repeated intermediate path when the final answer references it', () => {
    const artifacts = detectArtifactsFromMessages(
      [
        {
          id: 'assistant-progress',
          type: 'assistant',
          content: 'Generated script: D:/workspace/output/build.js',
          timestamp: Date.now(),
          metadata: { isStreaming: false },
        },
        {
          id: 'assistant-final',
          type: 'assistant',
          content: 'Final file: D:/workspace/output/build.js',
          timestamp: Date.now(),
          metadata: { isStreaming: false, isFinalAnswer: true },
        },
      ],
      'sess1',
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].artifact.role).toBe(ArtifactRole.Deliverable);
    expect(artifacts[0].artifact.messageId).toBe('assistant-final');
  });
});
