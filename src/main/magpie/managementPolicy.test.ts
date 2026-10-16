import { it, expect } from 'vitest';
import { mayEditProviderFromManagement } from './managementPolicy';
it('blocks reserved ids even when escaped or nested and permits ordinary provider changes', () => {
  expect(mayEditProviderFromManagement('{"id":"openai","key":"fake-only"}')).toBe(true);
  expect(mayEditProviderFromManagement('{"id":"zhiyuan-host-local"}')).toBe(false);
  expect(mayEditProviderFromManagement('{"from":"zhiyuan\\u002dhost-local","id":"copy"}')).toBe(
    false,
  );
  expect(mayEditProviderFromManagement('{"refs":["zhiyuan-host-enterprise"]}')).toBe(false);
  expect(mayEditProviderFromManagement('not json')).toBe(false);
});
