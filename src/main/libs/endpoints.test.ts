import { afterEach, expect, test } from 'vitest';

import { getSkillStoreSiteUrl, getSkillStoreUrl } from './endpoints';

const originalSkillStoreUrl = process.env.LOBSTERAI_SKILL_STORE_URL;
const originalSkillStoreSiteUrl = process.env.LOBSTERAI_SKILL_STORE_SITE_URL;

afterEach(() => {
  if (originalSkillStoreUrl == null) {
    delete process.env.LOBSTERAI_SKILL_STORE_URL;
  } else {
    process.env.LOBSTERAI_SKILL_STORE_URL = originalSkillStoreUrl;
  }

  if (originalSkillStoreSiteUrl == null) {
    delete process.env.LOBSTERAI_SKILL_STORE_SITE_URL;
  } else {
    process.env.LOBSTERAI_SKILL_STORE_SITE_URL = originalSkillStoreSiteUrl;
  }
});

test('getSkillStoreUrl defaults to the official ClawHub API', () => {
  delete process.env.LOBSTERAI_SKILL_STORE_URL;
  expect(getSkillStoreUrl()).toBe('https://clawhub.ai/api/v1/skills');
});

test('getSkillStoreSiteUrl derives the official site from the API URL', () => {
  delete process.env.LOBSTERAI_SKILL_STORE_URL;
  delete process.env.LOBSTERAI_SKILL_STORE_SITE_URL;
  expect(getSkillStoreSiteUrl()).toBe('https://clawhub.ai');
});

test('getSkillStoreSiteUrl respects explicit site overrides', () => {
  process.env.LOBSTERAI_SKILL_STORE_SITE_URL = 'https://example.com/custom-skill-store';
  expect(getSkillStoreSiteUrl()).toBe('https://example.com/custom-skill-store');
});
