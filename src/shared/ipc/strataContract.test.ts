import { expect, test } from 'vitest';
import { StrataEngineKind, StrataFamilyId } from '../strata/constants';
import {
  StrataServiceStatus,
  type StrataCatalogEntry,
  type StrataStatusSnapshot,
} from '../strata/types';
import { strataContract } from './strataContract';

test('status results retain the native status domain and reject unknown values', () => {
  for (const status of Object.values(StrataServiceStatus)) {
    const input = { status, checkedAt: '2026-10-26T00:00:00.000Z' };
    const result: StrataStatusSnapshot = strataContract.status.result.parse(input);
    expect(result).toEqual(input);
    expect(strataContract.start.result.parse(input)).toEqual(input);
    expect(strataContract.stop.result.parse(input)).toEqual(input);
  }
  expect(
    strataContract.status.result.safeParse({ status: 'unsupported-status', checkedAt: '' }).success,
  ).toBe(false);
});

test('catalog results retain native family and engine types without renderer casts', () => {
  const input: StrataCatalogEntry = {
    id: 'qwen-catalog-entry',
    family: StrataFamilyId.QwenFlashNext,
    engine: StrataEngineKind.Qwen,
    displayName: 'Qwen',
    modelLaunchId: 'qwen-launch',
    hardware: { minSystemRamGb: 64, minVramGb: 24, minDiskGb: 100, docNoteKey: 'hardware' },
    docUrl: 'https://example.com/model',
  };
  const result: StrataCatalogEntry[] = strataContract.catalog.result.parse([input]);
  expect(result).toEqual([input]);
  for (const field of ['family', 'engine']) {
    expect(
      strataContract.catalog.result.safeParse([{ ...input, [field]: 'unsupported-value' }]).success,
    ).toBe(false);
  }
});
