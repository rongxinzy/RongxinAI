/**
 * Unit tests for the request-body normalization that keeps recorded provider
 * tapes machine-independent: filesystem-dependent `ls -l` block totals must
 * not reach the request hash, while unrelated "total N" text stays intact.
 */
import { describe, expect, it } from 'vitest';

import { normalizeLsBlockTotals } from './piProviderTape';

/** JSON-escaped ls output as normalize() sees it (rows already collapsed). */
const escaped = (value: string): string => JSON.stringify(value).slice(1, -1);

describe('normalizeLsBlockTotals', () => {
  it('blanks block totals that lead collapsed ls rows', () => {
    const body = `{"content":"${escaped('total 0\n<LS-META> .\n<LS-META> data\n<PI_REPLAY_WORKDIR>')}"}`;
    expect(normalizeLsBlockTotals(body)).toContain(escaped('total <LS-BLOCKS>\n<LS-META> .'));
  });

  it('blanks block totals before empty listings anchored by a path placeholder', () => {
    const body = `{"content":"${escaped('total 8\n<PI_REPLAY_WORKDIR>')}"}`;
    expect(normalizeLsBlockTotals(body)).toContain(escaped('total <LS-BLOCKS>'));
  });

  it('normalizes different totals to the same bytes', () => {
    const local = `x${escaped('total 0\n<LS-META> data')}y`;
    const ci = `x${escaped('total 4096\n<LS-META> data')}y`;
    expect(normalizeLsBlockTotals(local)).toBe(normalizeLsBlockTotals(ci));
  });

  it('leaves total numbers outside ls output untouched', () => {
    const body = `{"content":"${escaped('a total 42 items were processed\ntotal 7\n')}other"}`;
    expect(normalizeLsBlockTotals(body)).toBe(body);
  });
});
