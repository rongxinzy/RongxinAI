import { describe, expect, test } from 'vitest';

import { providersContract } from './providersContract';
import { providersContractChannels } from './providersContract.channels';

/**
 * Schema fidelity tests: fixtures below are copied from real renderer call
 * sites so a schema drift that would reject a valid production invoke fails
 * here, and representative bad inputs are proven rejected.
 */

// --- agents ----------------------------------------------------------------

/** Full agent row as AgentManager stores it (agentsList / agentsGet result). */
const agentRow = {
  id: 'agent-crawler',
  name: '爬虫专家',
  description: 'collects pages',
  systemPrompt: 'You collect pages.',
  identity: 'crawler',
  model: 'claude-sonnet-5',
  workingDirectory: '/home/me/projects/demo',
  icon: 'bug',
  skillIds: ['web-search'],
  mcpIds: ['context7'],
  enabled: true,
  pinned: false,
  pinOrder: null,
  isDefault: false,
  source: 'expert-package',
  presetId: 'zhiyuan-crawler',
  createdAt: 1770000000000,
  updatedAt: 1770000000000,
};

test('agents envelope result accepts real agent rows', () => {
  expect(
    providersContract.agentsList.result.safeParse({ success: true, agents: [agentRow] }).success,
  ).toBe(true);
  expect(
    providersContract.agentsGet.result.safeParse({ success: true, agent: agentRow }).success,
  ).toBe(true);
  expect(
    providersContract.agentsDelete.result.safeParse({ success: true, deleted: true }).success,
  ).toBe(true);
  expect(
    providersContract.agentsList.result.safeParse({ success: false, error: 'db locked' }).success,
  ).toBe(true);
  expect(
    providersContract.agentsGet.result.safeParse({ success: true, agent: { id: 1 } }).success,
  ).toBe(false);
});

test('agentsCreate accepts the CreateExpertDialog payload', () => {
  // CreateExpertDialog submit: name/identity/description/systemPrompt/icon/skillIds/mcpIds/source
  expect(
    providersContract.agentsCreate.args.safeParse([
      {
        name: '翻译专家',
        identity: 'translator',
        description: 'translates text',
        systemPrompt: 'Translate faithfully.',
        icon: 'languages',
        skillIds: ['web-search'],
        mcpIds: [],
        source: 'custom',
      },
    ]).success,
  ).toBe(true);
  expect(
    providersContract.agentsCreate.args.safeParse([{ name: 'x', source: 'weird' }]).success,
  ).toBe(false);
  expect(providersContract.agentsCreate.args.safeParse([{ description: 'no name' }]).success).toBe(
    false,
  );
});

test('agentsUpdate accepts the agentService partial patch', () => {
  // agentService.updateAgent sends only changed fields
  expect(
    providersContract.agentsUpdate.args.safeParse(['agent-1', { enabled: false, pinned: true }])
      .success,
  ).toBe(true);
  expect(
    providersContract.agentsUpdate.args.safeParse(['agent-1', { name: 'new name' }]).success,
  ).toBe(true);
  expect(
    providersContract.agentsUpdate.args.safeParse(['agent-1', { pinned: 'yes' }]).success,
  ).toBe(false);
});

test('agentsImportExpertPackage result accepts the import payload', () => {
  expect(
    providersContract.agentsImportExpertPackage.result.safeParse({
      success: true,
      agentIds: ['agent-a', 'agent-b'],
      expertType: 'package',
      name: 'zhiyuan-expert-pack',
    }).success,
  ).toBe(true);
  expect(
    providersContract.agentsImportExpertPackage.result.safeParse({
      success: false,
      error: 'plugin.json missing',
    }).success,
  ).toBe(true);
});

test('agentsGetPresetExperts result accepts the localized catalog shape', () => {
  const experts = [
    {
      name: 'data-analyst',
      displayName: { en: 'Data Analyst', zh: '数据分析师' },
      profession: { en: 'Analyst', zh: '分析师' },
      displayDescription: { en: 'Analyzes data', zh: '分析数据' },
      categoryId: 'data',
      tags: [{ en: 'sql', zh: 'sql' }],
      quickPrompts: [{ en: 'clean this csv', zh: '清洗这份 csv' }],
      workflow: ['load', 'clean', 'report'],
      path: '/SKILLs/experts/data-analyst',
      mcpIds: ['context7'],
      pythonRequirements: { requirementsPath: './requirements.txt' },
      pypiMirrors: ['https://pypi.tuna.tsinghua.edu.cn/simple'],
      skillCatalog: [
        {
          id: 'anthropic-document-skills',
          category: 'office',
          install: 'npx skills add anthropics/skills',
        },
      ],
    },
  ];
  expect(providersContract.agentsGetPresetExperts.result.safeParse({ experts }).success).toBe(true);
  expect(
    providersContract.agentsGetPresetExperts.result.safeParse({ experts: [], error: 'no root' })
      .success,
  ).toBe(true);
});

// --- magpie ----------------------------------------------------------------

test('magpie saveProvider/testProvider accept the ModelSettingsPanel form payload', () => {
  // ProviderFormModal submit → magpie.saveProvider(input)
  const input = {
    id: 'prov-openai',
    name: 'OpenAI',
    api: 'openai-completions' as const,
    baseUrl: 'https://api.openai.com/v1',
    key: 'sk-xxx',
    models: ['gpt-4o', 'gpt-4o-mini'],
    fallback: ['gpt-4o-mini'],
  };
  expect(providersContract.magpieSaveProvider.args.safeParse([input]).success).toBe(true);
  expect(providersContract.magpieTestProvider.args.safeParse([input]).success).toBe(true);
  // key optional on edit, id optional on create
  expect(
    providersContract.magpieSaveProvider.args.safeParse([
      { name: 'New', api: 'anthropic-messages', baseUrl: 'https://api.anthropic.com', models: [] },
    ]).success,
  ).toBe(true);
  expect(
    providersContract.magpieSaveProvider.args.safeParse([
      { name: 'Bad', api: 'grpc', baseUrl: 'x://', models: [] },
    ]).success,
  ).toBe(false);
});

test('magpie setModel / setProviderEnabled accept their payloads', () => {
  // CodingAgentManager model picker sends { agentId, field, value }
  expect(
    providersContract.magpieSetModel.args.safeParse([
      { agentId: 'agent-1', field: 'primaryModel', value: 'gpt-4o' },
    ]).success,
  ).toBe(true);
  expect(providersContract.magpieSetProviderEnabled.args.safeParse(['prov-1', false]).success).toBe(
    true,
  );
  expect(providersContract.magpieSetModel.args.safeParse([{ agentId: 'a' }]).success).toBe(false);
});

// --- enterprise ----------------------------------------------------------------

test('enterprise login/changePassword accept the session bridge payloads', () => {
  expect(
    providersContract.enterpriseSessionLogin.args.safeParse([
      {
        aepBaseUrl: 'https://aep.example.com',
        enterpriseId: 'rongxin',
        username: 'li.si',
        password: 'secret',
      },
    ]).success,
  ).toBe(true);
  expect(
    providersContract.enterpriseSessionChangePassword.args.safeParse([
      { currentPassword: 'old', newPassword: 'new' },
    ]).success,
  ).toBe(true);
  expect(
    providersContract.enterpriseSessionLogin.args.safeParse([{ username: 'li.si' }]).success,
  ).toBe(false);
});

test('enterpriseGetConfig result accepts null and overlay rows', () => {
  expect(providersContract.enterpriseGetConfig.result.safeParse(null).success).toBe(true);
  expect(
    providersContract.enterpriseGetConfig.result.safeParse({
      ui: { 'settings.models': 'hide' },
      disableUpdate: true,
      version: '1.2.3',
      name: 'Custom Brand',
    }).success,
  ).toBe(true);
  expect(
    providersContract.enterpriseGetConfig.result.safeParse({ ui: { page: 'remove' } }).success,
  ).toBe(false);
});

// --- community auth / model pool --------------------------------------------------

test('auth results accept the session shapes', () => {
  expect(
    providersContract.authGetCommunityUser.result.safeParse({
      success: true,
      user: { id: 'u-1', email: 'me@example.com' },
    }).success,
  ).toBe(true);
  expect(providersContract.authGetCommunityUser.result.safeParse({ success: false }).success).toBe(
    true,
  );
  expect(
    providersContract.authCommunityLogin.result.safeParse({ success: false, error: 'x' }).success,
  ).toBe(true);
  expect(providersContract.authCommunityLogout.result.safeParse({ success: true }).success).toBe(
    true,
  );
});

test('modelPool stream input accepts the chat request envelope', () => {
  // enterprise renderer sends { requestId, conversationId, body }
  expect(
    providersContract.modelPoolStream.args.safeParse([
      {
        requestId: 'req_abc123',
        conversationId: 'conv_abc123',
        body: { messages: [{ role: 'user', content: 'hi' }], temperature: 0.7 },
      },
    ]).success,
  ).toBe(true);
  expect(
    providersContract.modelPoolStream.args.safeParse([
      { requestId: 'bad id!', conversationId: 'c', body: {} },
    ]).success,
  ).toBe(false);
  expect(providersContract.modelPoolCancelStream.args.safeParse(['req_abc123']).success).toBe(true);
});

describe('contract/channel consistency', () => {
  test('channel map stays in sync with the contract', () => {
    expect(Object.keys(providersContractChannels).sort()).toEqual(
      Object.keys(providersContract).sort(),
    );
    for (const method of Object.keys(providersContract)) {
      expect(providersContractChannels[method as keyof typeof providersContract]).toBe(
        (providersContract[method as keyof typeof providersContract] as { channel: string })
          .channel,
      );
    }
  });
});
