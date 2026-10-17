import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import { parseMediaMarkers, stripMediaMarkers } from './channelMediaMarkers';

test('extracts platform-neutral local media references without duplicates', () => {
  const text = [
    'Result:',
    '![chart](C:\\output\\chart.png)',
    '[report](C:\\output\\report.pdf)',
    'C:\\output\\chart.png',
  ].join('\n');
  const markers = parseMediaMarkers(text);
  expect(markers).toMatchObject([
    { type: 'image', path: 'C:\\output\\chart.png', name: 'chart' },
    { type: 'file', path: 'C:\\output\\report.pdf', name: 'report' },
  ]);
  expect(stripMediaMarkers(text, markers)).toBe('Result:\n\nC:\\output\\chart.png');
});

test('retains malformed legacy media markers as text', () => {
  const text = '[DINGTALK_FILE]{invalid}[/DINGTALK_FILE]';
  expect(parseMediaMarkers(text)).toEqual([]);
  expect(stripMediaMarkers(text, [])).toBe(text);
});

test('converts file URLs into native absolute paths', () => {
  const fileUrl = 'file:///C:/output/chart.png';
  const markers = parseMediaMarkers(`![chart](${fileUrl})`);
  expect(markers[0]?.path).toBe(fileURLToPath(fileUrl));
});

test('extracts absolute paths outside the historical home and temp prefixes', () => {
  const text = [
    'Done',
    '![result](/workspace/project/result.png)',
    '[notes](/opt/data/notes.pdf)',
    '/opt/data/shot.png',
    'see https://example.com/result.png',
    '![remote](//cdn.example.com/a.png)',
  ].join('\n');
  const markers = parseMediaMarkers(text);
  expect(markers).toMatchObject([
    { type: 'image', path: '/workspace/project/result.png', name: 'result' },
    { type: 'file', path: '/opt/data/notes.pdf', name: 'notes' },
    { type: 'image', path: '/opt/data/shot.png' },
  ]);
  expect(stripMediaMarkers(text, markers)).toBe(
    'Done\n\nsee https://example.com/result.png\n![remote](//cdn.example.com/a.png)',
  );
});
