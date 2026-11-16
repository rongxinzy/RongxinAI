import { expect, test } from 'vitest';
import { toLocalfileUrl } from './localfileUrl';

test('preserves remote image URLs and encodes native path delimiters exactly once', () => {
  expect(toLocalfileUrl('https://images.example.com/result.png?token=a')).toBe(
    'https://images.example.com/result.png?token=a',
  );
  expect(toLocalfileUrl('/work/图 #1?100%.png')).toBe(
    'localfile:///work/%E5%9B%BE%20%231%3F100%25.png',
  );
  expect(toLocalfileUrl('file:///work/chart%20%231.png')).toBe(
    'localfile:///work/chart%20%231.png',
  );
  expect(toLocalfileUrl('C:\\images\\result.png')).toBe('localfile:///C:/images/result.png');
});
