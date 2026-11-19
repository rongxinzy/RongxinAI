import { expect, test, vi } from 'vitest';
import { RETIRED_STRATA_HOST_PROVIDER_ID } from '../magpie/hostProviders';
import { resolveDefaultAgentModelRef } from './defaultAgentModel';

const { read } = vi.hoisted(() => ({ read: vi.fn<() => string | undefined>() }));
vi.mock('./runtimeServices', () => ({ getStore: () => ({ get: read }) }));

test('leaves a retired model default unset without selecting another provider', () => {
  read.mockReturnValue(` ${RETIRED_STRATA_HOST_PROVIDER_ID}/old-model `);
  expect(resolveDefaultAgentModelRef()).toBe('');
});

test('keeps the user’s default when its model name contains the retired brand', () => {
  read.mockReturnValue(' custom-provider/strata ');
  expect(resolveDefaultAgentModelRef()).toBe('custom-provider/strata');
});
