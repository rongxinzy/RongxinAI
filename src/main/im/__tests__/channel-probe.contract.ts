/**
 * Channel Probe Contract Suite
 *
 * Pure-function validators for IMConnectivityTestResult shape and constraints.
 * Platform test files inject their own probe output; this suite verifies the
 * contract is upheld regardless of platform or mock configuration.
 *
 * P1 — Contract防线: CI automatically verifies all channels conform to the
 * same output contract.  Any change to probe logic that breaks the contract
 * is caught before merge.
 */

import { expect } from 'vitest';

import type {
  IMConnectivityCheck,
  IMConnectivityCheckCode,
  IMConnectivityCheckLevel,
  IMConnectivityTestResult,
  IMConnectivityVerdict,
  Platform,
} from '../types';

// ── Shared validators (pure functions, usable by any platform test) ──

/** All recognised check codes — kept in sync with types.ts. */
const VALID_CHECK_CODES: ReadonlySet<string> = new Set<IMConnectivityCheckCode>([
  'missing_credentials',
  'auth_check',
  'gateway_running',
  'inbound_activity',
  'outbound_activity',
  'platform_last_error',
  'feishu_group_requires_mention',
  'feishu_event_subscription_required',
  'discord_group_requires_mention',
  'telegram_privacy_mode_hint',
  'dingtalk_bot_membership_hint',
  'openclaw_gateway_not_running',
  'qq_guild_mention_hint',
  'qq_mention_hint',
  'weixin_not_logged_in',
  'weixin_account_missing',
  'weixin_gateway_probe_failed',
]);

const VALID_LEVELS: ReadonlySet<string> = new Set<IMConnectivityCheckLevel>([
  'pass',
  'info',
  'warn',
  'fail',
]);

const VALID_VERDICTS: ReadonlySet<string> = new Set<IMConnectivityVerdict>([
  'pass',
  'warn',
  'fail',
]);

// ── Individual check validators ──

export function validateCheckShape(check: IMConnectivityCheck): void {
  expect(check, 'each check must have a code').toHaveProperty('code');
  expect(typeof check.code, 'check.code must be a string').toBe('string');
  expect(
    VALID_CHECK_CODES.has(check.code),
    `unknown check code: ${check.code}`,
  ).toBe(true);

  expect(check, 'each check must have a level').toHaveProperty('level');
  expect(
    VALID_LEVELS.has(check.level),
    `check.level must be one of pass|info|warn|fail, got: ${check.level}`,
  ).toBe(true);

  expect(check, 'each check must have a message').toHaveProperty('message');
  expect(typeof check.message, 'check.message must be a string').toBe('string');
  expect(check.message.length, 'check.message must not be empty').toBeGreaterThan(0);
}

/** Check codes that serve the same purpose as auth_check / missing_credentials. */
const AUTH_EQUIVALENT_CODES: ReadonlySet<string> = new Set([
  'auth_check',
  'missing_credentials',
  // WeChat uses QR login — these platform-specific codes are its auth-equivalent
  'weixin_not_logged_in',
  'weixin_account_missing',
  // When the Gateway is not running, no auth check is possible
  'openclaw_gateway_not_running',
]);

export function validateAuthCoverage(checks: IMConnectivityCheck[]): void {
  const codes = checks.map(c => c.code);
  const hasAuth = codes.some(c => AUTH_EQUIVALENT_CODES.has(c));
  expect(
    hasAuth,
    `must include an auth-equivalent check (auth_check, missing_credentials, or platform-specific equivalent), got: ${codes.join(', ')}`,
  ).toBe(true);
}

export function validateJsonSerializable(result: IMConnectivityTestResult): void {
  let roundTripped: IMConnectivityTestResult;
  expect(() => {
    const json = JSON.stringify(result);
    roundTripped = JSON.parse(json) as IMConnectivityTestResult;
  }, 'result must be JSON-serializable (cron SystemEvent payload requirement)').not.toThrow();

  // Verify key fields survive round-trip
  expect(roundTripped!).toHaveProperty('platform');
  expect(roundTripped!).toHaveProperty('verdict');
  expect(roundTripped!).toHaveProperty('checks');
  expect(Array.isArray(roundTripped!.checks), 'checks must be an array after deserialization').toBe(true);

  // suggestion is optional but must survive round-trip when present
  for (let i = 0; i < result.checks.length; i++) {
    const orig = result.checks[i];
    const rt = roundTripped!.checks[i];
    if (orig.suggestion !== undefined) {
      expect(rt?.suggestion, `check[${i}].suggestion must survive JSON round-trip`).toBe(orig.suggestion);
    }
  }
}

/** Validate the verdict is consistent with the worst check level. */
export function validateVerdictConsistency(result: IMConnectivityTestResult): void {
  const { checks, verdict } = result;

  // Verdict must be a recognised value
  expect(
    VALID_VERDICTS.has(verdict),
    `verdict must be pass|warn|fail, got: ${verdict}`,
  ).toBe(true);

  const hasFail = checks.some(c => c.level === 'fail');
  const hasWarn = checks.some(c => c.level === 'warn');

  if (hasFail) {
    expect(verdict, 'verdict must be fail when any check.level is fail').toBe('fail');
  } else if (hasWarn) {
    expect(['warn', 'fail'].includes(verdict),
      'verdict must be warn or fail when any check.level is warn').toBe(true);
  }
  // If no fail/warn, verdict is expected to be pass (though the caller
  // may have platform-specific logic — this is a soft check).
}

// ── Aggregate contract runner ──

export interface ContractInput {
  platform: Platform;
  result: IMConnectivityTestResult;
}

/**
 * Run the full channel probe contract against a probe result.
 *
 * Usage from platform test files:
 * ```ts
 * import { runChannelProbeContract } from './channel-probe.contract';
 *
 * test('telegram probe contract', async () => {
 *   const result = await manager.testGateway('telegram', { ... });
 *   runChannelProbeContract({ platform: 'telegram', result });
 * });
 * ```
 */
export function runChannelProbeContract(input: ContractInput): void {
  const { platform, result } = input;

  expect(result, 'result must be defined').toBeDefined();
  expect(result.platform, 'result.platform must match the probed platform').toBe(platform);
  expect(typeof result.testedAt, 'result.testedAt must be a number (Unix ms)').toBe('number');
  expect(result.testedAt, 'result.testedAt must be > 0').toBeGreaterThan(0);
  expect(result.testedAt, 'result.testedAt must be recent (within 1 hour)').toBeGreaterThan(
    Date.now() - 3_600_000,
  );

  expect(Array.isArray(result.checks), 'result.checks must be an array').toBe(true);
  expect(result.checks.length, 'result.checks must not be empty').toBeGreaterThan(0);

  for (const check of result.checks) {
    validateCheckShape(check);
  }

  validateAuthCoverage(result.checks);
  validateJsonSerializable(result);
  validateVerdictConsistency(result);
}
