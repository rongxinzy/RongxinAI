import { expect, test } from 'vitest';

import {
  buildModelScopeSkillPageUrl,
  fetchModelScopeSkillMarketplace,
  parseModelScopeSkillUrl,
  resolveModelScopeSkillInstallSource,
} from './modelscopeSkillMarketplace';

test('buildModelScopeSkillPageUrl keeps the full ModelScope skill id path', () => {
  expect(buildModelScopeSkillPageUrl('@AMap-Web/amap-lbs-skill')).toBe(
    'https://modelscope.cn/skills/@AMap-Web/amap-lbs-skill',
  );
});

test('parseModelScopeSkillUrl extracts ModelScope skill ids from canonical links', () => {
  expect(parseModelScopeSkillUrl('https://modelscope.cn/skills/@AMap-Web/amap-lbs-skill')).toEqual({
    skillId: '@AMap-Web/amap-lbs-skill',
  });
  expect(parseModelScopeSkillUrl('https://example.com/skills/@AMap-Web/amap-lbs-skill')).toBeNull();
});

test('fetchModelScopeSkillMarketplace maps ModelScope skills to the app marketplace shape', async () => {
  const json = await fetchModelScopeSkillMarketplace({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          skills: [
            {
              id: '@AMap-Web/amap-lbs-skill',
              display_name: 'Amap Skill',
              description: 'fallback description',
              developer: 'AMap-Web',
              source_url: 'https://github.com/AMap-Web/amap-lbs-skill',
              logo_url: 'https://resources.modelscope.cn/skills/amap.png',
              category: 'developer-tools',
              tags: ['category:developer-tools', 'custom_tag:general-tools'],
              custom_tag: ['api-design'],
              downloads: 791,
              locales: {
                zh: { description: '中文描述' },
                en: { description: 'English description' },
              },
            },
          ],
        },
      }),
      text: async () => '',
    }),
  });

  expect(JSON.parse(json)).toEqual({
    data: {
      value: {
        marketplace: [
          {
            id: '@AMap-Web/amap-lbs-skill',
            name: 'Amap Skill',
            description: {
              zh: '中文描述',
              en: 'English description',
            },
            stats: {
              downloads: 791,
            },
            url: 'https://modelscope.cn/skills/@AMap-Web/amap-lbs-skill',
            iconUrl: 'https://resources.modelscope.cn/skills/amap.png',
            installSource: 'https://modelscope.cn/skills/@AMap-Web/amap-lbs-skill',
            version: '1.0.0',
            source: {
              from: 'ModelScope',
              url: 'https://github.com/AMap-Web/amap-lbs-skill',
              author: 'AMap-Web',
            },
          },
        ],
        localSkill: [],
        hasMore: false,
      },
    },
  });
});

test('fetchModelScopeSkillMarketplace orders a ModelScope page by downloads', async () => {
  const json = await fetchModelScopeSkillMarketplace({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          skills: [
            {
              id: '@demo/low-skill',
              display_name: 'Low Skill',
              description: 'low',
              source_url: 'https://github.com/demo/low-skill',
              category: 'other',
              tags: ['MIT License', 'solo-tag'],
              downloads: 5,
            },
            {
              id: '@demo/high-skill',
              display_name: 'High Skill',
              description: 'high',
              source_url: 'https://github.com/demo/high-skill',
              category: 'developer-tools',
              tags: ['developer-tools', 'shared-tag'],
              downloads: 500,
            },
            {
              id: '@demo/mid-skill',
              display_name: 'Mid Skill',
              description: 'mid',
              source_url: 'https://github.com/demo/mid-skill',
              category: 'developer-tools',
              tags: ['shared-tag', 'other'],
              downloads: 300,
            },
          ],
        },
      }),
      text: async () => '',
    }),
  });

  expect(JSON.parse(json)).toEqual({
    data: {
      value: {
        marketplace: [
          {
            id: '@demo/high-skill',
            name: 'High Skill',
            description: {
              zh: 'high',
              en: 'high',
            },
            stats: {
              downloads: 500,
            },
            url: 'https://modelscope.cn/skills/@demo/high-skill',
            installSource: 'https://modelscope.cn/skills/@demo/high-skill',
            version: '1.0.0',
            source: {
              from: 'ModelScope',
              url: 'https://github.com/demo/high-skill',
            },
          },
          {
            id: '@demo/mid-skill',
            name: 'Mid Skill',
            description: {
              zh: 'mid',
              en: 'mid',
            },
            stats: {
              downloads: 300,
            },
            url: 'https://modelscope.cn/skills/@demo/mid-skill',
            installSource: 'https://modelscope.cn/skills/@demo/mid-skill',
            version: '1.0.0',
            source: {
              from: 'ModelScope',
              url: 'https://github.com/demo/mid-skill',
            },
          },
          {
            id: '@demo/low-skill',
            name: 'Low Skill',
            description: {
              zh: 'low',
              en: 'low',
            },
            stats: {
              downloads: 5,
            },
            url: 'https://modelscope.cn/skills/@demo/low-skill',
            installSource: 'https://modelscope.cn/skills/@demo/low-skill',
            version: '1.0.0',
            source: {
              from: 'ModelScope',
              url: 'https://github.com/demo/low-skill',
            },
          },
        ],
        localSkill: [],
        hasMore: false,
      },
    },
  });
});

test('fetchModelScopeSkillMarketplace requests the specified page and reports more results', async () => {
  const requestedUrls: string[] = [];
  const json = await fetchModelScopeSkillMarketplace({
    pageNumber: 4,
    pageSize: 8,
    fetchImpl: async input => {
      requestedUrls.push(input);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          data: {
            skills: [],
            total: 40,
          },
        }),
        text: async () => '',
      };
    },
  });

  expect(requestedUrls).toEqual([
    'https://modelscope.cn/openapi/v1/skills?page_number=4&page_size=8',
  ]);
  expect(JSON.parse(json).data.value).toMatchObject({
    marketplace: [],
    hasMore: true,
  });
});

test('resolveModelScopeSkillInstallSource uses the ModelScope archive instead of an upstream source URL', async () => {
  await expect(
    resolveModelScopeSkillInstallSource('https://modelscope.cn/skills/@AMap-Web/amap-lbs-skill'),
  ).resolves.toBe(
    'https://www.modelscope.cn/skills/@AMap-Web/amap-lbs-skill/archive/zip/master',
  );
});

test('fetchModelScopeSkillMarketplace does not treat a ClawHub source URL as an install source', async () => {
  const json = await fetchModelScopeSkillMarketplace({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          skills: [
            {
              id: 'steipete/weather',
              display_name: 'Weather',
              source_url: 'https://clawhub.ai/steipete/weather',
            },
          ],
        },
      }),
      text: async () => '',
    }),
  });

  const skill = JSON.parse(json).data.value.marketplace[0];
  expect(skill.installSource).toBe('https://modelscope.cn/skills/steipete/weather');
  expect(skill.source.url).toBe('https://clawhub.ai/steipete/weather');
});

test('fetchModelScopeSkillMarketplace omits an install source when the skill only links back to ModelScope', async () => {
  const json = await fetchModelScopeSkillMarketplace({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          skills: [
            {
              id: '@demo/platform-only',
              display_name: 'Platform only',
              downloads: 10,
              install_command: ['npx skills add https://modelscope.cn/skills/@demo/platform-only'],
            },
          ],
        },
      }),
      text: async () => '',
    }),
  });

  const skill = JSON.parse(json).data.value.marketplace[0];
  expect(skill.installSource).toBe('https://modelscope.cn/skills/@demo/platform-only');
  expect(skill.url).toBe('https://modelscope.cn/skills/@demo/platform-only');
});

test('resolveModelScopeSkillInstallSource builds the official ModelScope archive endpoint', async () => {
  await expect(
    resolveModelScopeSkillInstallSource('https://modelscope.cn/skills/@demo/platform-only'),
  ).resolves.toBe(
    'https://www.modelscope.cn/skills/@demo/platform-only/archive/zip/master',
  );
});
