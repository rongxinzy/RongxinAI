import { expect, test } from 'vitest';

import { normalizeOcrText } from './ocrEngine';

test('collapses the spaces Windows OCR inserts between CJK characters', () => {
  expect(normalizeOcrText('季 度 经 营 分 析 报 告')).toBe('季度经营分析报告');
  expect(normalizeOcrText('营 业 收 入 12,875.00 万 元')).toBe('营业收入 12,875.00 万元');
});

test('leaves Latin text and single spaces alone', () => {
  expect(normalizeOcrText('Quarterly revenue 12,875.00')).toBe('Quarterly revenue 12,875.00');
  // CJK next to a digit keeps its separating space on purpose: joining them would
  // merge numbers into prose ("共 10 页" must not become "共10页").
  expect(normalizeOcrText('  第 1 页  ')).toBe('第 1 页');
});

test('drops spaces before closing CJK punctuation', () => {
  expect(normalizeOcrText('毛利率 42.6% ， 同比提升')).toBe('毛利率 42.6%， 同比提升');
});
