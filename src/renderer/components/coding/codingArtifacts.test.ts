import { describe, expect, test } from 'vitest';

import { CodingEventKind, type CodingEvent } from '../../../shared/codingAgent';
import { collectCodingFileArtifacts, resolveArtifactFilePath } from './codingArtifacts';

let sequence = 0;
const event = (kind: CodingEvent['kind'], payload: Record<string, unknown>): CodingEvent => {
  sequence += 1;
  return { id: `event-${sequence}`, laneId: 'lane-1', sequence, kind, payload, createdAt: sequence };
};

describe('collectCodingFileArtifacts', () => {
  test('collects an html file written through the filesystem broker', () => {
    const writeEvent = event(CodingEventKind.FileChange, {
      action: 'write',
      path: 'C:\\work\\report.html',
    });
    const artifacts = collectCodingFileArtifacts([writeEvent], 'lane-1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].artifact).toMatchObject({
      sessionId: 'lane-1',
      type: 'html',
      title: 'report.html',
      fileName: 'report.html',
      filePath: 'C:\\work\\report.html',
      content: '',
      role: 'deliverable',
    });
    expect(artifacts[0].needsFileLoad).toBe(true);
    expect(artifacts[0].version).toBe(writeEvent.id);
  });

  test('uses the diff new text as inline content without a disk read', () => {
    const artifacts = collectCodingFileArtifacts(
      [
        event(CodingEventKind.FileChange, {
          type: 'diff',
          path: '/work/chart.svg',
          oldText: '',
          newText: '<svg></svg>',
        }),
      ],
      'lane-1',
    );
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].artifact.content).toBe('<svg></svg>');
    expect(artifacts[0].needsFileLoad).toBe(false);
  });

  test('collects write-tool inputs from builtin tool calls', () => {
    const artifacts = collectCodingFileArtifacts(
      [
        event(CodingEventKind.ToolCall, {
          toolCallId: 'call-1',
          toolName: 'write',
          toolInput: { file_path: '/work/page.html', content: '<html></html>' },
          status: 'pending',
        }),
      ],
      'lane-1',
    );
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].artifact.content).toBe('<html></html>');
    expect(artifacts[0].needsFileLoad).toBe(false);
  });

  test('accepts ACP raw input with path and content even for unknown tools', () => {
    const artifacts = collectCodingFileArtifacts(
      [
        event(CodingEventKind.ToolCall, {
          toolCallId: 'call-2',
          rawInput: { path: '/work/diagram.mmd', content: 'graph TD' },
        }),
      ],
      'lane-1',
    );
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].artifact.type).toBe('mermaid');
  });

  test('skips source-code files and non-write events', () => {
    const artifacts = collectCodingFileArtifacts(
      [
        event(CodingEventKind.FileChange, { action: 'write', path: '/work/app.ts' }),
        event(CodingEventKind.FileChange, { action: 'read', path: '/work/readme.md' }),
        event(CodingEventKind.Message, { content: 'hello' }),
      ],
      'lane-1',
    );
    expect(artifacts).toHaveLength(0);
  });

  test('keeps the latest rewrite of the same path', () => {
    const events = [
      event(CodingEventKind.FileChange, {
        type: 'diff',
        path: '/work/report.html',
        newText: '<html>v1</html>',
      }),
      event(CodingEventKind.FileChange, { action: 'write', path: '/work/report.html' }),
    ];
    const artifacts = collectCodingFileArtifacts(events, 'lane-1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].version).toBe(events[1].id);
    // The inline diff content survives the later content-less broker write.
    expect(artifacts[0].artifact.content).toBe('<html>v1</html>');
    expect(artifacts[0].needsFileLoad).toBe(false);
  });

  test('merges a relative tool input with the absolute broker write', () => {
    const events = [
      event(CodingEventKind.ToolCall, {
        toolCallId: 'call-1',
        title: 'Writing tmp/hello.html',
        kind: 'edit',
        status: 'completed',
        rawInput: { path: 'tmp/hello.html', content: '<!DOCTYPE html>' },
      }),
      event(CodingEventKind.FileChange, {
        action: 'write',
        path: 'C:\\work\\tmp\\hello.html',
      }),
    ];
    const artifacts = collectCodingFileArtifacts(events, 'lane-1', 'C:/work');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].artifact.filePath).toBe('C:\\work\\tmp\\hello.html');
    expect(artifacts[0].artifact.content).toBe('<!DOCTYPE html>');
    expect(artifacts[0].toolCallId).toBe('call-1');
    expect(artifacts[0].version).toBe(events[1].id);
  });
});

describe('resolveArtifactFilePath', () => {
  test('keeps absolute paths', () => {
    expect(resolveArtifactFilePath('C:\\work\\a.html', '/base')).toBe('C:\\work\\a.html');
    expect(resolveArtifactFilePath('/work/a.html', '/base')).toBe('/work/a.html');
  });

  test('strips file URLs and leading slashes before drive letters', () => {
    expect(resolveArtifactFilePath('file:///C:/work/a.html')).toBe('C:/work/a.html');
  });

  test('resolves relative paths against the base directory', () => {
    expect(resolveArtifactFilePath('out/a.html', '/base')).toBe('/base/out/a.html');
  });
});
