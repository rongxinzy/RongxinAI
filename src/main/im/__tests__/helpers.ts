/**
 * Test helpers for channel probe contract tests.
 *
 * Supplies factory functions that construct representative probe results
 * for each platform without touching better-sqlite3 or the network.
 *
 * These helpers validate the OUTPUT CONTRACT — the shape and constraints
 * that every probe must satisfy — rather than testing internal logic.
 */

import type {
  IMConnectivityCheck,
  IMConnectivityCheckCode,
  IMConnectivityCheckLevel,
  IMConnectivityTestResult,
  IMConnectivityVerdict,
  Platform,
} from '../types';

// ── Result factory ──

export interface ProbeResultSpec {
  /** Override the default test timestamp. */
  testedAt?: number;
  /** Checks to include (defaults to [missing_credentials]). */
  checks?: IMConnectivityCheck[];
  /** Override the auto-computed verdict. */
  verdict?: IMConnectivityVerdict;
}

/**
 * Build a probe result whose verdict is derived from the worst check level
 * (fail > warn > pass) unless explicitly overridden.
 */
export function buildProbeResult(
  platform: Platform,
  spec: ProbeResultSpec = {},
): IMConnectivityTestResult {
  const checks = spec.checks ?? [makeMissingCredentialsCheck()];
  const verdict =
    spec.verdict ??
    (checks.some(c => c.level === 'fail')
      ? 'fail'
      : checks.some(c => c.level === 'warn')
        ? 'warn'
        : 'pass');

  return {
    platform,
    testedAt: spec.testedAt ?? Date.now(),
    verdict,
    checks,
  };
}

// ── Check factories ──

export function makeCheck(
  code: IMConnectivityCheckCode,
  level: IMConnectivityCheckLevel,
  message: string,
  suggestion?: string,
): IMConnectivityCheck {
  const check: IMConnectivityCheck = { code, level, message };
  if (suggestion !== undefined) check.suggestion = suggestion;
  return check;
}

export function makeMissingCredentialsCheck(fields = 'botToken'): IMConnectivityCheck {
  return makeCheck(
    'missing_credentials',
    'fail',
    `Missing required credentials: ${fields}`,
    `Please fill in ${fields}.`,
  );
}

export function makeAuthCheckPass(username = 'test-bot'): IMConnectivityCheck {
  return makeCheck('auth_check', 'pass', `Authentication successful: @${username}`);
}

export function makeAuthCheckFail(reason = 'invalid token'): IMConnectivityCheck {
  return makeCheck(
    'auth_check',
    'fail',
    `Authentication failed: ${reason}`,
    'Please check your token.',
  );
}

export function makeGatewayRunningCheck(): IMConnectivityCheck {
  return makeCheck('gateway_running', 'info', 'Channel runtime is running.');
}

export function makeInboundActivityCheck(level: 'pass' | 'warn' = 'pass'): IMConnectivityCheck {
  return level === 'pass'
    ? makeCheck('inbound_activity', 'pass', 'Channel has active sessions.')
    : makeCheck(
        'inbound_activity',
        'warn',
        'No recent channel activity.',
        'Send a test message to verify.',
      );
}

// ── Known platform list (source of truth: src/shared/platform/constants.ts) ──

export const ALL_IM_PLATFORMS: readonly Platform[] = [
  'telegram',
  'discord',
  'feishu',
  'dingtalk',
  'wecom',
  'weixin',
  'qq',
] as const;
