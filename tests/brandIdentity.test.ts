import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

import { describe, expect, test } from 'vitest';

const retiredBrand = ['rongxin', 'ai'].join('');
const allowedTechnicalIdentifiers = [
  `rongxinzy/${retiredBrand}`,
  `${retiredBrand}.krli.org`,
  `${retiredBrand}-ui-adapter`,
  `${retiredBrand}-ci`,
];

describe('brand identity', () => {
  test('uses the current product name in the renderer title', () => {
    expect(fs.readFileSync('index.html', 'utf8')).toContain('<title>ZhiYuan Agent</title>');
  });

  test('keeps the retired product name out of tracked copy', () => {
    const matches = execFileSync('git', ['grep', '-n', '-i', retiredBrand], {
      encoding: 'utf8',
    })
      .split(/\r?\n/u)
      .filter(Boolean);
    const violations = matches.filter(match => {
      const normalized = allowedTechnicalIdentifiers.reduce(
        (value, identifier) => value.replaceAll(identifier, ''),
        match.toLowerCase(),
      );
      return normalized.includes(retiredBrand);
    });

    expect(violations).toEqual([]);
  });
});
