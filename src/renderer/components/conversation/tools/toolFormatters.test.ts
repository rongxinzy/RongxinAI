import { describe, expect, test } from 'vitest';

import { extractFileDiffSpec, extractWebSources, getToolInputSummary } from './toolFormatters';

describe('toolFormatters', () => {
  test('extracts diff specs for edit and write tool calls', () => {
    expect(
      extractFileDiffSpec('edit', {
        path: 'src/app.ts',
        oldText: 'const a = 1;',
        newText: 'const a = 2;',
      }),
    ).toEqual({
      fileName: 'src/app.ts',
      oldContent: 'const a = 1;',
      newContent: 'const a = 2;',
    });

    expect(
      extractFileDiffSpec('write', {
        file_path: 'src/new.ts',
        content: 'export const x = 1;',
      }),
    ).toEqual({
      fileName: 'src/new.ts',
      oldContent: '',
      newContent: 'export const x = 1;',
    });
  });

  test('extracts web sources from JSON or plain text results', () => {
    const jsonOutput = JSON.stringify({
      results: [
        { title: 'Docs', url: 'https://docs.example.com/guide', snippet: 'Read guide' },
        { title: 'Duplicate', url: 'https://docs.example.com/guide' },
      ],
    });
    expect(extractWebSources({ query: 'docs' }, jsonOutput)).toEqual([
      { url: 'https://docs.example.com/guide', title: 'Docs', snippet: 'Read guide' },
    ]);
  });

  test('formats concise tool input summaries', () => {
    expect(getToolInputSummary('bash', { command: 'bun run test\necho done' })).toBe(
      'bun run test',
    );
    expect(getToolInputSummary('read', { path: 'src/index.ts' })).toBe('src/index.ts');
  });
});
