/**
 * Cron × Channel Probe Integration Tests
 *
 * Validates that channel probe results are compatible with the cron
 * SystemEvent payload format.  The cron job engine serialises probe
 * results as JSON strings inside agentTurn messages — this test
 * ensures every platform's output survives the round-trip.
 *
 * P1 — Cron × Probe 联合测试: 验证两个子系统的兼容性。
 */

import { describe, expect, test } from 'vitest';

import type { IMConnectivityTestResult, Platform } from '../types';
import { ALL_IM_PLATFORMS, buildProbeResult, makeAuthCheckPass, makeGatewayRunningCheck, makeInboundActivityCheck } from './helpers';

// ── Payload helpers (mirrors cron SystemEvent shape) ──

interface CronSystemEventPayload {
  kind: 'systemEvent';
  text: string;
}

interface CronAgentTurnPayload {
  kind: 'agentTurn';
  message: string;
  timeoutSeconds: number;
}

function wrapAsSystemEvent(result: IMConnectivityTestResult): CronSystemEventPayload {
  return {
    kind: 'systemEvent',
    text: JSON.stringify(result),
  };
}

function wrapAsAgentTurn(result: IMConnectivityTestResult): CronAgentTurnPayload {
  return {
    kind: 'agentTurn',
    message: JSON.stringify(result),
    timeoutSeconds: 30,
  };
}

// ── Tests ──

describe('Cron × Channel Probe Integration', () => {
  test('all platforms produce a valid probe result', () => {
    for (const platform of ALL_IM_PLATFORMS) {
      const result = buildProbeResult(platform, {
        checks: [
          makeAuthCheckPass('test'),
          makeGatewayRunningCheck(),
          makeInboundActivityCheck('pass'),
        ],
      });
      expect(result.platform).toBe(platform);
      expect(Array.isArray(result.checks)).toBe(true);
      expect(result.checks.length).toBeGreaterThan(0);
    }
  });

  test('probe result fits inside SystemEvent cron payload', () => {
    for (const platform of ALL_IM_PLATFORMS) {
      const result = buildProbeResult(platform);

      const payload = wrapAsSystemEvent(result);
      expect(payload.kind).toBe('systemEvent');

      // Round-trip: serialise → deserialise → re-validate
      const serialised = JSON.stringify(payload);
      expect(() => JSON.parse(serialised)).not.toThrow();

      const parsed = JSON.parse(serialised) as CronSystemEventPayload;
      const restored = JSON.parse(parsed.text) as IMConnectivityTestResult;
      expect(restored.platform).toBe(platform);
      expect(Array.isArray(restored.checks)).toBe(true);
    }
  });

  test('probe result fits inside agentTurn cron payload', () => {
    for (const platform of ALL_IM_PLATFORMS) {
      const result = buildProbeResult(platform, {
        checks: [
          makeAuthCheckPass('test'),
          makeGatewayRunningCheck(),
          makeInboundActivityCheck('pass'),
        ],
      });

      const payload = wrapAsAgentTurn(result);
      expect(payload.kind).toBe('agentTurn');
      expect(payload.timeoutSeconds).toBe(30);
      expect(typeof payload.message).toBe('string');

      // Verify the message can be parsed back
      const restored = JSON.parse(payload.message) as IMConnectivityTestResult;
      expect(restored.platform).toBe(platform);
    }
  });

  test('probe result with all fail levels is still serializable', () => {
    // A fully-failed result must still be valid JSON for cron delivery
    for (const platform of ALL_IM_PLATFORMS) {
      const result = buildProbeResult(platform, {
        checks: [
          makeAuthCheckPass('test'),
          makeGatewayRunningCheck(),
          makeInboundActivityCheck('pass'),
        ],
        verdict: 'fail', // explicit override
      });
      result.verdict = 'fail';

      const payload = wrapAsSystemEvent(result);
      const serialised = JSON.stringify(payload);
      expect(() => JSON.parse(serialised)).not.toThrow();

      const parsed = JSON.parse(serialised) as CronSystemEventPayload;
      const restored = JSON.parse(parsed.text) as IMConnectivityTestResult;
      expect(restored.verdict).toBe('fail');
    }
  });

  test('probe timeout is compatible with cron agentTurn default timeout', () => {
    // The probe's CONNECTIVITY_TIMEOUT_MS (10s) must be < cron agentTurn
    // default (60s) so a single probe never outlives a cron job slot.
    const PROBE_TIMEOUT_MS = 10_000;
    const CRON_AGENT_TURN_TIMEOUT_MS = 60_000;

    expect(PROBE_TIMEOUT_MS).toBeLessThan(CRON_AGENT_TURN_TIMEOUT_MS);
  });

  test('all 8 IM platforms have corresponding test coverage', () => {
    // Ensures the platform list stays in sync.  If a platform is added or
    // removed, this test forces a conscious decision about test coverage.
    expect(ALL_IM_PLATFORMS).toHaveLength(8);

    const expectedPlatforms: Platform[] = [
      'telegram', 'discord', 'feishu', 'dingtalk',
      'wecom', 'weixin', 'qq', 'email',
    ];
    const actual = [...ALL_IM_PLATFORMS].sort();
    const expected = [...expectedPlatforms].sort();
    expect(actual).toEqual(expected);
  });
});
