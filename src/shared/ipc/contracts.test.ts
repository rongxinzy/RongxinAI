import { describe, expect, test } from 'vitest';

import { mcpContract } from './mcpContract';
import { skillsContract } from './skillsContract';
import { marketplaceContract, MarketplaceSearchRequestSchema } from '../marketplace/contract';

/**
 * Schema fidelity tests: fixtures below are copied from real renderer call
 * sites so a schema drift that would reject a valid production invoke fails
 * here, and representative bad inputs are proven rejected.
 */

// --- Skills -----------------------------------------------------------------

test('skills setEnabled accepts the renderer payload shape', () => {
  // src/renderer/services/skill.ts setSkillEnabled
  expect(
    skillsContract.setEnabled.args.safeParse([{ id: 'web-search', enabled: false }]).success,
  ).toBe(true);
});

test('skills setEnabledBatch accepts the batch payload shape', () => {
  // setSkillsEnabled happy path
  expect(
    skillsContract.setEnabledBatch.args.safeParse([{ ids: ['a', 'b'], enabled: true }]).success,
  ).toBe(true);
});

test('skills download accepts both real arities', () => {
  // downloadSkill with options (SkillInstallFlow passes displayName/iconUrl)
  expect(
    skillsContract.download.args.safeParse([
      'occlassify/skill',
      { displayName: 'OC Classify', iconUrl: 'https://example.com/i.png' },
    ]).success,
  ).toBe(true);
  // downloadSkill without options sends only the source
  expect(skillsContract.download.args.safeParse(['occlassify/skill']).success).toBe(true);
});

test('skills download rejects a non-object options payload', () => {
  expect(skillsContract.download.args.safeParse(['src', 'nope']).success).toBe(false);
});

test('skills confirmInstall accepts exactly the SecurityReportAction union', () => {
  // useSkillInstallFlow SecurityReportAction
  for (const action of ['install', 'installDisabled', 'cancel'] as const) {
    expect(skillsContract.confirmInstall.args.safeParse(['pending-1', action]).success).toBe(true);
  }
  expect(skillsContract.confirmInstall.args.safeParse(['pending-1', 'force']).success).toBe(false);
});

test('skills config roundtrip payload parses', () => {
  // getSkillConfig / setSkillConfig / testEmailConnectivity shapes
  const config = { host: 'imap.qq.com', port: '993', ssl: 'true' };
  expect(skillsContract.setConfig.args.safeParse(['email', config]).success).toBe(true);
  expect(skillsContract.getConfig.args.safeParse(['email']).success).toBe(true);
  expect(skillsContract.testEmailConnectivity.args.safeParse(['email', config]).success).toBe(true);
});

test('skills fetchMarketplace accepts the service options object', () => {
  // loadMarketplaceSkills passes { pageNumber, pageSize }
  expect(
    skillsContract.fetchMarketplace.args.safeParse([{ pageNumber: 2, pageSize: 8 }]).success,
  ).toBe(true);
  expect(skillsContract.fetchMarketplace.args.safeParse([undefined]).success).toBe(true);
  expect(skillsContract.fetchMarketplace.args.safeParse([]).success).toBe(true);
});

test('skills createCustom accepts the CreateSkillDialog payload', () => {
  expect(
    skillsContract.createCustom.args.safeParse([
      { id: 'my-skill', name: 'My Skill', description: 'd', content: 'prompt body' },
    ]).success,
  ).toBe(true);
  expect(
    skillsContract.createCustom.args.safeParse([{ id: 'x', name: 'n', description: 'd' }]).success,
  ).toBe(false);
});

test('skills envelope result accepts real SkillRecord rows', () => {
  const row = {
    id: 'web-search',
    name: 'web-search',
    description: 'Search the web',
    enabled: true,
    pinned: false,
    isOfficial: true,
    isBuiltIn: false,
    updatedAt: 1770000000000,
    prompt: 'Search the web for the query',
    skillPath: '/skills/web-search',
    iconUrl: 'https://example.com/icon.png',
    displayName: 'Web Search',
    metadataFields: { author: 'zhiyuan' },
    version: '1.0.0',
  };
  expect(skillsContract.list.result.safeParse({ success: true, skills: [row] }).success).toBe(true);
  expect(
    skillsContract.list.result.safeParse({ success: false, error: 'disk offline' }).success,
  ).toBe(true);
  expect(skillsContract.list.result.safeParse({ success: 'yes' }).success).toBe(false);
});

// --- MCP ----------------------------------------------------------------------

/** stdio form built by McpServerFormModal.buildValidatedFormData (custom tab). */
const stdioForm = {
  name: 'context7',
  description: 'Upgraded docs lookup',
  transportType: 'stdio' as const,
  timeout: 60,
  command: 'npx',
  args: ['-y', '@upstash/context7-mcp'],
  env: { DEFAULT_MINIMUM_TOKENS: '10000' },
};

/** http form built by useMcpTokenConnect.handleSaveToken. */
const tokenForm = {
  name: 'Feishu Wiki',
  description: 'Feishu wiki reader',
  transportType: 'http' as const,
  url: 'https://open.feishu.cn/mcp',
  headers: { Authorization: 'Bearer t-abc' },
  isBuiltIn: true,
  registryId: 'feishu-wiki',
};

test('mcp create accepts both real form payloads', () => {
  expect(mcpContract.create.args.safeParse([stdioForm]).success).toBe(true);
  expect(mcpContract.create.args.safeParse([tokenForm]).success).toBe(true);
});

test('mcp create rejects a wrong transport type', () => {
  expect(mcpContract.create.args.safeParse([{ ...stdioForm, transportType: 'grpc' }]).success).toBe(
    false,
  );
});

test('mcp update accepts a partial patch and strips unknown keys', () => {
  // McpManager edit flow sends only the changed fields
  expect(mcpContract.update.args.safeParse(['srv-1', { enabled: true }]).success).toBe(true);
  expect(
    mcpContract.update.args.safeParse(['srv-1', { description: 'new text', timeout: 120 }]).success,
  ).toBe(true);
  // Unknown keys are stripped (zod default), never forwarded to the store.
  const parsed = mcpContract.update.args.safeParse(['srv-1', { unknownField: 1, name: 'ok' }]);
  expect(parsed.success).toBe(true);
  if (parsed.success) {
    expect(parsed.data[1]).toEqual({ name: 'ok' });
  }
  expect(mcpContract.update.args.safeParse(['srv-1', { timeout: 'soon' }]).success).toBe(false);
});

test('mcp setEnabled accepts the toggle payload', () => {
  // McpInstalledTab switch
  expect(mcpContract.setEnabled.args.safeParse([{ id: 'srv-1', enabled: false }]).success).toBe(
    true,
  );
});

test('mcp authorize accepts the token-connect payload plus requestId', () => {
  // useMcpOfficialConnect passes form data; mcpService.authorize spreads in
  // authorizationRequestId.
  expect(
    mcpContract.authorize.args.safeParse([{ ...tokenForm, authorizationRequestId: 'req-9' }])
      .success,
  ).toBe(true);
  // useMcpTokenConnect-style call without an id (defensive: schema keeps it
  // optional) and a malformed headers map both behave as expected.
  expect(mcpContract.authorize.args.safeParse([tokenForm]).success).toBe(true);
  expect(
    mcpContract.authorize.args.safeParse([{ ...tokenForm, headers: 'Bearer x' }]).success,
  ).toBe(false);
});

test('mcp servers envelope result accepts stored rows', () => {
  const row = {
    id: 'srv-1',
    name: 'context7',
    description: 'docs',
    enabled: true,
    transportType: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    env: {},
    isBuiltIn: false,
    exposure: 'codemode' as const,
    createdAt: 1770000000000,
    updatedAt: 1770000000000,
  };
  expect(mcpContract.list.result.safeParse({ success: true, servers: [row] }).success).toBe(true);
  expect(
    mcpContract.delete.result.safeParse({ success: true, servers: [], refreshError: 'noop' })
      .success,
  ).toBe(true);
});

// --- Marketplace ----------------------------------------------------------------

test('marketplace search accepts request envelopes built by useMarketplaceSearch', () => {
  // Browse-mode params from buildMarketplaceSearchParams (no query)
  expect(
    MarketplaceSearchRequestSchema.safeParse({
      requestId: 'req-1',
      params: {
        limit: 12,
        pageNumber: 1,
        featuredOnly: false,
        fit: 'all',
      },
    }).success,
  ).toBe(true);
  // Query mode with cursor pagination (page > 1)
  expect(
    MarketplaceSearchRequestSchema.safeParse({
      requestId: 'req-2',
      params: {
        query: 'qwen3',
        limit: 24,
        pageNumber: 2,
        cursor: 'c1',
        device: 'base',
        task: 'chat',
        minStars: 10,
      },
    }).success,
  ).toBe(true);
});

test('marketplace search rejects an empty requestId and bad enum values', () => {
  expect(MarketplaceSearchRequestSchema.safeParse({ requestId: '', params: {} }).success).toBe(
    false,
  );
  expect(
    MarketplaceSearchRequestSchema.safeParse({ requestId: 'r', params: { task: 'math' } }).success,
  ).toBe(false);
  expect(
    MarketplaceSearchRequestSchema.safeParse({ requestId: 'r', params: { limit: 'many' } }).success,
  ).toBe(false);
});

test('marketplace cancelSearch takes the requestId string', () => {
  expect(marketplaceContract.cancelSearch.args.safeParse(['req-1']).success).toBe(true);
  expect(marketplaceContract.cancelSearch.args.safeParse([42]).success).toBe(false);
});

test('marketplace search result schema accepts a real result projection', () => {
  const result = {
    models: [
      {
        id: 'Qwen/Qwen3-4B-GGUF',
        name: 'Qwen3-4B-GGUF',
        author: 'Qwen',
        downloads: 1000,
        files: [{ name: 'qwen3-4b-q4_k_m.gguf', sizeBytes: 2500000000 }],
      },
    ],
    totalCount: 1,
    hasMore: false,
    nextCursor: undefined,
  };
  expect(marketplaceContract.search.result.safeParse(result).success).toBe(true);
});

describe('contract/channel consistency', () => {
  test('channel maps stay in sync with the contracts', async () => {
    const { skillsContractChannels } = await import('./skillsContract.channels');
    const { mcpContractChannels } = await import('./mcpContract.channels');
    const { marketplaceContractChannels } = await import('../marketplace/contract.channels');

    for (const [map, contract] of [
      [skillsContractChannels, skillsContract],
      [mcpContractChannels, mcpContract],
      [marketplaceContractChannels, marketplaceContract],
    ] as const) {
      expect(Object.keys(map).sort()).toEqual(Object.keys(contract).sort());
      for (const method of Object.keys(contract)) {
        expect(map[method as keyof typeof contract]).toBe(
          (contract[method as keyof typeof contract] as { channel: string }).channel,
        );
      }
    }
  });
});
