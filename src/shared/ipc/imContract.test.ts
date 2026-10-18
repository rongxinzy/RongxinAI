import { describe, expect, test } from 'vitest';

import { feishuInstallContract, imContract, imInstanceContract } from './imContract';
import { PlatformRegistry } from '../platform/constants';

/**
 * Schema fidelity tests: fixtures below are copied from real renderer call
 * sites (services/im.ts instance flows, IM settings forms,
 * WeixinLoginPanel, DingTalkInstanceSettings) so a schema drift that would
 * reject a valid production invoke fails here, and representative bad inputs
 * are proven rejected.
 */

/** Partial DingTalk patch as sent by DingTalkInstanceSettings save flow. */
const dingtalkPatch = {
  enabled: true,
  clientId: 'ding-abc',
  dmPolicy: 'pairing' as const,
  allowFrom: ['user-1'],
  sessionTimeout: 600,
};

describe('im contract args', () => {
  test('setConfig accepts a per-channel instance patch', () => {
    // imService.updateConfig persists e.g. a DingTalk instance edit
    expect(
      imContract.setConfig.args.safeParse([
        { dingtalk: { instances: [dingtalkPatch] } },
        { syncGateway: true },
      ]).success,
    ).toBe(true);
    // Weixin patches nest under the `weixin` key (WeixinPanel updateConfig)
    expect(
      imContract.setConfig.args.safeParse([{ weixin: { enabled: true, accountId: 'wx-1' } }])
        .success,
    ).toBe(true);
    expect(imContract.setConfig.args.safeParse([{ weixin: { workspaceId: 'ws-1' } }]).success).toBe(
      true,
    );
    // Settings-only patch (IMSettings save flow)
    expect(
      imContract.setConfig.args.safeParse([{ settings: { skillsEnabled: true } }]).success,
    ).toBe(true);
  });

  test('setConfig rejects an invalid policy value', () => {
    expect(
      imContract.setConfig.args.safeParse([
        { dingtalk: { instances: [{ ...dingtalkPatch, dmPolicy: 'anyone' }] } },
      ]).success,
    ).toBe(false);
    // Nested weixin values are validated too
    expect(imContract.setConfig.args.safeParse([{ weixin: { dmPolicy: 'anyone' } }]).success).toBe(
      false,
    );
  });

  test('gateway lifecycle methods take a known platform', () => {
    expect(imContract.startGateway.args.safeParse([PlatformRegistry.platforms[0]]).success).toBe(
      true,
    );
    expect(imContract.startGateway.args.safeParse(['icq']).success).toBe(false);
  });

  test('weixin login start/poll shapes match WeixinLoginPanel', () => {
    expect(imContract.weixinLoginStart.args.safeParse([]).success).toBe(true);
    expect(imContract.weixinLoginPoll.args.safeParse(['qr-ticket']).success).toBe(true);
    expect(imContract.weixinLoginPoll.args.safeParse([null]).success).toBe(false);
  });
});

describe('im instance contract args', () => {
  test('add/set/delete accept the services/im.ts payload shapes', () => {
    expect(imInstanceContract.addDingTalkInstance.args.safeParse(['main', 'ws-1']).success).toBe(
      true,
    );
    expect(imInstanceContract.deleteDingTalkInstance.args.safeParse(['inst-1']).success).toBe(true);
    // persistDingTalkInstanceConfig sends a partial patch + sync options
    expect(
      imInstanceContract.setDingTalkInstanceConfig.args.safeParse([
        'inst-1',
        dingtalkPatch,
        {
          syncGateway: false,
        },
      ]).success,
    ).toBe(true);
    // updateDingTalkInstanceConfig variant without options
    expect(
      imInstanceContract.setDingTalkInstanceConfig.args.safeParse(['inst-1', { enabled: false }])
        .success,
    ).toBe(true);
  });

  test('setFeishuInstanceConfig accepts the feishu groups record', () => {
    // FeishuInstanceSettings saves per-group overrides
    expect(
      imInstanceContract.setFeishuInstanceConfig.args.safeParse([
        'inst-2',
        {
          enabled: true,
          appId: 'cli_a',
          appSecret: 's',
          domain: 'https://open.feishu.cn',
          dmPolicy: 'open',
          allowFrom: [],
          groupPolicy: 'allowlist',
          groupAllowFrom: [],
          groups: { oc_1: { requireMention: true } },
          historyLimit: 20,
          streaming: true,
          replyMode: 'auto',
          blockStreaming: false,
          footer: { status: true },
          mediaMaxMb: 10,
          debug: false,
        },
        { syncGateway: true },
      ]).success,
    ).toBe(true);
    // Nested group values are validated too
    expect(
      imInstanceContract.setFeishuInstanceConfig.args.safeParse([
        'inst-2',
        { groups: { oc_1: { requireMention: 'yes' } } },
      ]).success,
    ).toBe(false);
  });

  test('instance config setters reject a non-object patch', () => {
    expect(imInstanceContract.setQQInstanceConfig.args.safeParse(['inst-1', 'nope']).success).toBe(
      false,
    );
  });
});

describe('im contract results', () => {
  test('add-instance envelope returns the full instance config', () => {
    // addDingTalkInstance dispatches result.instance into the store
    expect(
      imInstanceContract.addDingTalkInstance.result.safeParse({
        success: true,
        instance: {
          ...dingtalkPatch,
          clientSecret: 's',
          groupPolicy: 'open',
          separateSessionByConversation: true,
          groupSessionScope: 'group',
          sharedMemoryAcrossConversations: false,
          gatewayBaseUrl: '',
          debug: false,
          instanceId: 'inst-1',
          instanceName: 'main',
          workspaceId: 'ws-1',
        },
      }).success,
    ).toBe(true);
    expect(
      imInstanceContract.addDingTalkInstance.result.safeParse({
        success: false,
        error: 'duplicate name',
      }).success,
    ).toBe(true);
  });

  test('weixinLoginPoll covers the full status cycle', () => {
    for (const status of ['wait', 'scaned', 'confirmed', 'expired'] as const) {
      expect(imContract.weixinLoginPoll.result.safeParse({ success: true, status }).success).toBe(
        true,
      );
    }
    expect(
      imContract.weixinLoginPoll.result.safeParse({ success: false, status: 'timeout' }).success,
    ).toBe(false);
  });

  test('testGateway result accepts a connectivity report', () => {
    // imService.testConnectivity reads result.result.checks
    expect(
      imContract.testGateway.result.safeParse({
        success: true,
        result: {
          platform: PlatformRegistry.platforms[0],
          testedAt: 1770000000000,
          verdict: 'warn',
          checks: [
            {
              code: 'credentials',
              level: 'warn',
              message: 'token may be stale',
              suggestion: 're-login',
            },
          ],
        },
      }).success,
    ).toBe(true);
  });

  test('feishu install verify accepts and returns the success envelope', () => {
    expect(
      feishuInstallContract.verify.args.safeParse([{ appId: 'cli_a', appSecret: 's' }]).success,
    ).toBe(true);
    expect(feishuInstallContract.verify.args.safeParse(['cli_a']).success).toBe(false);
    expect(
      feishuInstallContract.verify.result.safeParse({ success: false, error: 'bad secret' })
        .success,
    ).toBe(true);
  });
});
