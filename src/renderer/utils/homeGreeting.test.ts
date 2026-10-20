import { expect, test } from 'vitest';

import { HomeGreetingLead, resolveHomeGreetingLead } from './homeGreeting';

test('splits the day into night, morning, afternoon, and evening leads', () => {
  expect(resolveHomeGreetingLead(new Date(2026, 9, 20, 2))).toBe(HomeGreetingLead.Night);
  expect(resolveHomeGreetingLead(new Date(2026, 9, 20, 5, 59))).toBe(HomeGreetingLead.Night);
  expect(resolveHomeGreetingLead(new Date(2026, 9, 20, 6))).toBe(HomeGreetingLead.Morning);
  expect(resolveHomeGreetingLead(new Date(2026, 9, 20, 11))).toBe(HomeGreetingLead.Morning);
  expect(resolveHomeGreetingLead(new Date(2026, 9, 20, 12))).toBe(HomeGreetingLead.Afternoon);
  expect(resolveHomeGreetingLead(new Date(2026, 9, 20, 17))).toBe(HomeGreetingLead.Afternoon);
  expect(resolveHomeGreetingLead(new Date(2026, 9, 20, 18))).toBe(HomeGreetingLead.Evening);
  expect(resolveHomeGreetingLead(new Date(2026, 9, 20, 23))).toBe(HomeGreetingLead.Evening);
});
