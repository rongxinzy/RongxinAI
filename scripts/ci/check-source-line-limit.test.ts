import { describe, expect, test } from 'vitest';

import { checkSourceLineLimit } from './check-source-line-limit.mjs';

const base = { limit: 1000, caps: { 'src/big.ts': 1500 } };

describe('checkSourceLineLimit', () => {
  test('passes when files are under the limit or within their cap', () => {
    expect(checkSourceLineLimit(base, { 'src/big.ts': 1400, 'src/a.ts': 1000 }, base)).toEqual([]);
  });

  test('fails a new file over the limit', () => {
    const errors = checkSourceLineLimit(base, { 'src/big.ts': 1500, 'src/new.ts': 1001 }, base);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('src/new.ts');
  });

  test('fails a capped file that grows past its cap', () => {
    expect(checkSourceLineLimit(base, { 'src/big.ts': 1501 }, base)[0]).toContain(
      'exceeds baseline cap',
    );
  });

  test('requires removing the entry once a file is at or under the limit', () => {
    expect(checkSourceLineLimit(base, { 'src/big.ts': 1000 }, base)[0]).toContain('remove from');
  });

  test('fails a raised cap even if the file fits it', () => {
    const head = { limit: 1000, caps: { 'src/big.ts': 1600 } };
    expect(checkSourceLineLimit(head, { 'src/big.ts': 1550 }, base)[0]).toContain('cap raised');
  });

  test('fails a new baseline entry', () => {
    const head = { limit: 1000, caps: { 'src/big.ts': 1500, 'src/new.ts': 1200 } };
    const errors = checkSourceLineLimit(head, { 'src/big.ts': 1500, 'src/new.ts': 1200 }, base);
    expect(errors).toEqual(['src/new.ts: new baseline entry (1200); the baseline may only shrink']);
  });

  test('fails a raised limit', () => {
    const head = { limit: 1200, caps: {} };
    expect(checkSourceLineLimit(head, {}, base)).toContain(
      'baseline limit raised from 1000 to 1200',
    );
  });

  test('allows lowering a cap and ignores vendored or non-source files', () => {
    const head = { limit: 1000, caps: { 'src/big.ts': 1200 } };
    expect(
      checkSourceLineLimit(
        head,
        { 'src/big.ts': 1100, 'src/vendor/x.ts': 5000, 'README.md': 4000 },
        base,
      ),
    ).toEqual([]);
  });

  test('fails orphaned baseline entries', () => {
    expect(checkSourceLineLimit(base, {}, base)[0]).toContain('not found');
  });
});
