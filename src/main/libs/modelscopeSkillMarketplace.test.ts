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
            installSource: 'https://github.com/AMap-Web/amap-lbs-skill',
            version: '1.0.0',
            source: {
              from: 'ModelScope',
              url: 'https://github.com/AMap-Web/amap-lbs-skill',
              author: 'AMap-Web',
            },
          },
        ],
        localSkill: [],
      },
    },
  });
});

test('fetchModelScopeSkillMarketplace keeps only featured skills', async () => {
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
            installSource: 'https://github.com/demo/high-skill',
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
            installSource: 'https://github.com/demo/mid-skill',
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
            installSource: 'https://github.com/demo/low-skill',
            version: '1.0.0',
            source: {
              from: 'ModelScope',
              url: 'https://github.com/demo/low-skill',
            },
          },
        ],
        localSkill: [],
      },
    },
  });
});

test('resolveModelScopeSkillInstallSource prefers source_url from skill detail', async () => {
  const requestedUrls: string[] = [];
  await expect(
    resolveModelScopeSkillInstallSource('https://modelscope.cn/skills/@AMap-Web/amap-lbs-skill', {
      fetchImpl: async input => {
        requestedUrls.push(input);
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            data: {
              id: '@AMap-Web/amap-lbs-skill',
              source_url: 'https://github.com/AMap-Web/amap-lbs-skill',
              install_command: [
                'npx skills add https://modelscope.cn/skills/@AMap-Web/amap-lbs-skill',
              ],
            },
          }),
          text: async () => '',
        };
      },
    }),
  ).resolves.toBe('https://github.com/AMap-Web/amap-lbs-skill');
  expect(requestedUrls).toEqual([
    'https://modelscope.cn/openapi/v1/skills/@AMap-Web/amap-lbs-skill',
  ]);
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
  expect(skill.installSource).toBeUndefined();
  expect(skill.url).toBe('https://modelscope.cn/skills/@demo/platform-only');
});

test('resolveModelScopeSkillInstallSource returns null when no supported source is published', async () => {
  await expect(
    resolveModelScopeSkillInstallSource('https://modelscope.cn/skills/@demo/platform-only', {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          data: {
            id: '@demo/platform-only',
            install_command: ['npx skills add https://modelscope.cn/skills/@demo/platform-only'],
          },
        }),
        text: async () => '',
      }),
    }),
  ).resolves.toBeNull();
});
