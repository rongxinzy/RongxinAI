import { expect, test } from 'vitest';
import { QuickActionService } from './quickAction';

test('subscribes to language changes only once across repeated initialization', () => {
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;
  const service = new QuickActionService({
    subscribe() {
      subscribeCalls += 1;
      return () => {
        unsubscribeCalls += 1;
      };
    },
  });

  for (let index = 0; index < 20; index += 1) {
    service.initialize();
  }

  expect(subscribeCalls).toBe(1);

  service.dispose();
  expect(unsubscribeCalls).toBe(1);

  service.initialize();
  expect(subscribeCalls).toBe(2);
});
