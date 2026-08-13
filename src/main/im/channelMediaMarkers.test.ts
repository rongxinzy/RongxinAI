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
  const markers = parseMediaMarkers('![chart](file:///C:/output/chart.png)');
  expect(markers[0]?.path).toMatch(/^[A-Za-z]:[\\/]output[\\/]chart\.png$/);
});
