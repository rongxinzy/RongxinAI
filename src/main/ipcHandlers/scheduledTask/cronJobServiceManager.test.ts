import { expect, test, vi } from 'vitest';

import { getCronJobService, initCronJobServiceManager } from './cronJobServiceManager';

test('uses the canonical scheduler service without an Agent runtime fallback', () => {
  const canonical = { listJobs: vi.fn() };
  initCronJobServiceManager({
    getScheduledTaskService: () => canonical as never,
  });

  expect(getCronJobService()).toBe(canonical);
});
