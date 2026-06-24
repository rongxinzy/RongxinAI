import { expect, test } from 'vitest';

import {
  buildClawHubSkillInstallSource,
  buildClawHubSkillPageUrl,
  buildClawHubSkillSourceUrl,
  findAmbiguousClawHubSkillSlugs,
  mergeClawHubSkillDetail,
} from './skillMarketplace';

test('buildClawHubSkillPageUrl prefers canonical owner slug paths', () => {
  expect(buildClawHubSkillPageUrl('https://clawhub.ai', {
    slug: 'automation-workflows',
    owner: {
      slug: 'jk-0001',
    },
  })).toBe('https://clawhub.ai/jk-0001/automation-workflows');
});

test('buildClawHubSkillPageUrl falls back to owner username when slug is missing', () => {
  expect(buildClawHubSkillPageUrl('https://clawhub.ai/', {
    slug: 'automation-workflows',
    owner: {
      username: 'jk-0001',
    },
  })).toBe('https://clawhub.ai/jk-0001/automation-workflows');
});

test('buildClawHubSkillPageUrl falls back to legacy /skills path without owner metadata', () => {
  expect(buildClawHubSkillPageUrl('https://clawhub.ai', {
    slug: 'automation-workflows',
  })).toBe('https://clawhub.ai/skills/automation-workflows');
});

test('buildClawHubSkillPageUrl uses id when slug is unavailable', () => {
  expect(buildClawHubSkillPageUrl('https://clawhub.ai', {
    id: 'automation-workflows',
    owner: {
      slug: 'jk-0001',
    },
  })).toBe('https://clawhub.ai/jk-0001/automation-workflows');
});

test('buildClawHubSkillPageUrl can derive canonical path from api url fields', () => {
  expect(buildClawHubSkillPageUrl('https://clawhub.ai', {
    slug: 'admapix',
    url: 'https://clawhub.ai/fly0pants/admapix',
  })).toBe('https://clawhub.ai/fly0pants/admapix');
});

test('buildClawHubSkillInstallSource returns the scoped install source', () => {
  expect(buildClawHubSkillInstallSource({
    slug: 'automation-workflows',
    owner: {
      slug: 'jk-0001',
    },
  })).toBe('clawhub:automation-workflows');
});

test('buildClawHubSkillInstallSource can derive owner from canonical url fields', () => {
  expect(buildClawHubSkillInstallSource({
    slug: 'admapix',
    url: 'https://clawhub.ai/fly0pants/admapix',
  })).toBe('clawhub:admapix');
});

test('buildClawHubSkillInstallSource returns a ClawHub-prefixed slug without owner metadata', () => {
  expect(buildClawHubSkillInstallSource({
    slug: 'automation-workflows',
  })).toBe('clawhub:automation-workflows');
});

test('buildClawHubSkillSourceUrl always uses the official ClawHub root', () => {
  expect(buildClawHubSkillSourceUrl('https://clawhub.ai/')).toBe('https://clawhub.ai');
});

test('mergeClawHubSkillDetail merges detail owner into the marketplace item', () => {
  expect(mergeClawHubSkillDetail(
    {
      slug: 'automation-workflows',
      displayName: 'Automation Workflows',
    },
    {
      skill: {
        slug: 'automation-workflows',
        displayName: 'Automation Workflows',
      },
      owner: {
        handle: 'jk-0001',
        displayName: 'JK',
      },
    },
  )).toEqual({
    slug: 'automation-workflows',
    displayName: 'Automation Workflows',
    owner: {
      handle: 'jk-0001',
      displayName: 'JK',
    },
  });
});

test('findAmbiguousClawHubSkillSlugs detects repeated slugs', () => {
  expect(Array.from(findAmbiguousClawHubSkillSlugs([
    { slug: 'automation-workflows', owner: { handle: 'jk-0001' } },
    { slug: 'automation-workflows', owner: { handle: 'dreamboat2000' } },
    { slug: 'self-improving-agent', owner: { handle: 'pskoett' } },
  ]))).toEqual(['automation-workflows']);
});
