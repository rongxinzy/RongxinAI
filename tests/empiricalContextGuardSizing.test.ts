import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CoworkErrorKind } from '../src/common/coworkError';
import { setLanguage } from '../src/main/i18n';
import {
  LlamaCppAgentEligibilityReason,
  type LlamaCppAgentModelEligibility,
} from '../src/shared/llamacpp';
import { ProviderName } from '../src/shared/providers';
import type { NvidiaSmiSnapshot } from '../src/shared/hardware';

// ── Hoisted mocks for LlamaCpp Running Model Registry ────────────────────────
const hoistedRegistry = vi.hoisted(() => ({
  isLlamaCppModelRunning: vi.fn(),
  getLlamaCppModelAgentEligibility: vi.fn(),
}));

vi.mock('../src/main/libs/llamacppRunningModelRegistry', () => ({
  isLlamaCppModelRunning: hoistedRegistry.isLlamaCppModelRunning,
  getLlamaCppModelAgentEligibility: hoistedRegistry.getLlamaCppModelAgentEligibility,
}));

// ── Hoisted mocks for Pi Retry Cancellation ──────────────────────────────────
const hoistedRetry = vi.hoisted(() => ({
  cancelPiRetry: vi.fn(async () => undefined),
  waitForPiRetryCancellation: vi.fn(async () => undefined),
}));

vi.mock('../src/main/libs/agentEngine/piRetryCancellation', () => ({
  cancelPiRetry: hoistedRetry.cancelPiRetry,
  waitForPiRetryCancellation: hoistedRetry.waitForPiRetryCancellation,
}));

import {
  assertLlamaCppWorkModeContext,
  assertWorkModeContextWindow,
  WORK_MODE_MIN_CONTEXT_WINDOW,
} from '../src/main/libs/llamacppWorkModeContextGuard';
import { resolveAutomaticLlamaCppContextSize } from '../src/shared/llamacpp/defaults';
import {
  PiRuntimeTurnEvents,
  type PiRuntimeTurnHost,
} from '../src/main/libs/agentEngine/piRuntimeTurnEvents';
import type { ActivePiSession } from '../src/main/libs/agentEngine/piRuntimeSessionState';

describe('Empirical Verification Harness — Context Window Guard, Sizing & Auto-Retry', () => {
  beforeEach(() => {
    setLanguage('en');
    hoistedRegistry.isLlamaCppModelRunning.mockReset();
    hoistedRegistry.getLlamaCppModelAgentEligibility.mockReset();
    hoistedRetry.cancelPiRetry.mockClear();
    hoistedRetry.waitForPiRetryCancellation.mockClear();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Suite 1: assertWorkModeContextWindow & assertLlamaCppWorkModeContext
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Suite 1: Work Mode Context Guards Boundary & Provider Matrix', () => {
    const testProviders = [
      ProviderName.LlamaCpp,
      ProviderName.OpenAI,
      ProviderName.Anthropic,
      ProviderName.Custom,
    ];

    const contextValues = [
      { val: undefined, expectThrow: false, desc: 'undefined (unprobed/custom)' },
      { val: null as unknown as number, expectThrow: false, desc: 'null (unprobed/custom)' },
      { val: 0, expectThrow: false, desc: '0 (unspecified)' },
      { val: -100, expectThrow: false, desc: '-100 (invalid non-positive)' },
      { val: 4096, expectThrow: true, desc: '4096 (small model)' },
      { val: 8192, expectThrow: true, desc: '8192 (standard small model)' },
      { val: 16383, expectThrow: true, desc: '16383 (critical boundary: 1 token below minimum)' },
      { val: 16384, expectThrow: false, desc: '16384 (exact boundary: minimum required)' },
      { val: 32767, expectThrow: false, desc: '32767 (above Work mode minimum)' },
      { val: 32768, expectThrow: false, desc: '32768 (standard 32k window)' },
      { val: 65536, expectThrow: false, desc: '65536 (standard 64k window)' },
    ];

    it.each(
      testProviders.flatMap(provider =>
        contextValues.map(ctx => ({
          provider,
          ...ctx,
        })),
      ),
    )(
      'assertWorkModeContextWindow for $provider with context $desc -> throws: $expectThrow',
      ({ provider, val, expectThrow }) => {
        const modelId = `${provider}/test-model`;
        if (expectThrow) {
          expect(() =>
            assertWorkModeContextWindow({
              providerName: provider,
              modelId,
              contextWindow: val,
            }),
          ).toThrow(
            new RegExp(
              `Model "${modelId}" context window \\(${val} tokens\\) is below the minimum ${WORK_MODE_MIN_CONTEXT_WINDOW} required for Work mode`,
            ),
          );
        } else {
          expect(() =>
            assertWorkModeContextWindow({
              providerName: provider,
              modelId,
              contextWindow: val,
            }),
          ).not.toThrow();
        }
      },
    );

    describe('assertLlamaCppWorkModeContext provider discrimination', () => {
      it.each([ProviderName.OpenAI, ProviderName.Anthropic, ProviderName.Custom])(
        'ignores non-LlamaCpp provider %s even when model is not running or context is small',
        provider => {
          hoistedRegistry.isLlamaCppModelRunning.mockReturnValue(false);
          expect(() =>
            assertLlamaCppWorkModeContext({
              providerName: provider,
              modelId: `${provider}/any-model`,
            }),
          ).not.toThrow();
        },
      );

      it('throws when LlamaCpp model is not running', () => {
        hoistedRegistry.isLlamaCppModelRunning.mockReturnValue(false);
        expect(() =>
          assertLlamaCppWorkModeContext({
            providerName: ProviderName.LlamaCpp,
            modelId: 'llamacpp/qwen-local',
          }),
        ).toThrow(/coworkLlamaCppModelNotRunning|not running/i);
      });

      it.each([
        { runtimeCtx: 4096, shouldThrow: true },
        { runtimeCtx: 8192, shouldThrow: true },
        { runtimeCtx: 16383, shouldThrow: true },
        { runtimeCtx: 16384, shouldThrow: true },
        { runtimeCtx: 32767, shouldThrow: true },
        { runtimeCtx: 32768, shouldThrow: false },
        { runtimeCtx: 65536, shouldThrow: false },
      ])(
        'enforces 32768 runtime minimum for LlamaCpp: runtimeCtx=$runtimeCtx throws=$shouldThrow',
        ({ runtimeCtx, shouldThrow }) => {
          hoistedRegistry.isLlamaCppModelRunning.mockReturnValue(true);
          const eligible = runtimeCtx >= 32768;
          const eligibility: LlamaCppAgentModelEligibility = eligible
            ? {
                eligible: true,
                reason: LlamaCppAgentEligibilityReason.Eligible,
                requiredContextWindow: 32768,
                runtimeContextWindow: runtimeCtx,
                canIncreaseContextWindow: false,
              }
            : {
                eligible: false,
                reason: LlamaCppAgentEligibilityReason.RuntimeContextTooSmall,
                requiredContextWindow: 32768,
                runtimeContextWindow: runtimeCtx,
                canIncreaseContextWindow: true,
              };

          hoistedRegistry.getLlamaCppModelAgentEligibility.mockReturnValue(eligibility);

          if (shouldThrow) {
            expect(() =>
              assertLlamaCppWorkModeContext({
                providerName: ProviderName.LlamaCpp,
                modelId: 'llamacpp/qwen-local',
              }),
            ).toThrow(/too small a context window/i);
          } else {
            expect(() =>
              assertLlamaCppWorkModeContext({
                providerName: ProviderName.LlamaCpp,
                modelId: 'llamacpp/qwen-local',
              }),
            ).not.toThrow();
          }
        },
      );

      it('handles LlamaCpp Unknown and TrainedContextTooSmall eligibility reasons', () => {
        hoistedRegistry.isLlamaCppModelRunning.mockReturnValue(true);

        // Unknown
        hoistedRegistry.getLlamaCppModelAgentEligibility.mockReturnValue({
          eligible: false,
          reason: LlamaCppAgentEligibilityReason.RuntimeContextUnknown,
          requiredContextWindow: 32768,
          canIncreaseContextWindow: true,
        });
        expect(() =>
          assertLlamaCppWorkModeContext({
            providerName: ProviderName.LlamaCpp,
            modelId: 'llamacpp/qwen-local',
          }),
        ).toThrow(/not report an effective context window|unknown/i);

        // TrainedContextTooSmall
        hoistedRegistry.getLlamaCppModelAgentEligibility.mockReturnValue({
          eligible: false,
          reason: LlamaCppAgentEligibilityReason.TrainedContextTooSmall,
          requiredContextWindow: 32768,
          trainedContextWindow: 8192,
          canIncreaseContextWindow: false,
        });
        expect(() =>
          assertLlamaCppWorkModeContext({
            providerName: ProviderName.LlamaCpp,
            modelId: 'llamacpp/qwen-local',
          }),
        ).toThrow(/trained for only \d+ context tokens|training/i);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Suite 2: resolveAutomaticLlamaCppContextSize Matrix
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Suite 2: resolveAutomaticLlamaCppContextSize Matrix', () => {
    const memoryScenarios = [
      { mem: undefined, desc: 'undefined RAM' },
      { mem: 8192, desc: '8GB RAM' },
      { mem: 16384, desc: '16GB RAM' },
      { mem: 24575, desc: '24GB - 1MiB RAM' },
      { mem: 24576, desc: '24GB RAM (exact threshold)' },
      { mem: 32768, desc: '32GB RAM' },
      { mem: 65536, desc: '64GB RAM' },
    ];

    const platforms: Array<'darwin' | 'win32' | 'linux'> = ['darwin', 'win32', 'linux'];

    describe('With high VRAM Nvidia GPU (>= 20GB / 20480 MiB)', () => {
      const highVramSnapshot: NvidiaSmiSnapshot = {
        source: 'nvidia-smi',
        available: true,
        checkedAt: '2026-11-10T00:00:00.000Z',
        gpus: [{ index: 0, name: 'RTX 4090', memoryTotalMiB: 24576 }],
      };

      it.each(
        platforms.flatMap(platform =>
          memoryScenarios.map(mem => ({
            platform,
            ...mem,
          })),
        ),
      )(
        'returns 32768 on $platform with $desc when high VRAM GPU is present',
        ({ platform, mem }) => {
          const result = resolveAutomaticLlamaCppContextSize(highVramSnapshot, {
            platform,
            totalMemoryMiB: mem,
          });
          expect(result).toBe('32768');
        },
      );
    });

    describe('With low VRAM Nvidia GPU (< 20GB, e.g. 8GB)', () => {
      const lowVramSnapshot: NvidiaSmiSnapshot = {
        source: 'nvidia-smi',
        available: true,
        checkedAt: '2026-11-10T00:00:00.000Z',
        gpus: [{ index: 0, name: 'RTX 3070', memoryTotalMiB: 8192 }],
      };

      it.each([
        // High RAM (>= 24GB) -> 32768
        { platform: 'linux', mem: 24576, expected: '32768' },
        { platform: 'linux', mem: 32768, expected: '32768' },
        { platform: 'linux', mem: 65536, expected: '32768' },
        { platform: 'win32', mem: 24576, expected: '32768' },
        { platform: 'win32', mem: 32768, expected: '32768' },
        { platform: 'darwin', mem: 24576, expected: '32768' },
        { platform: 'darwin', mem: 32768, expected: '32768' },
        // Low RAM (< 24GB) -> 8192
        { platform: 'linux', mem: 8192, expected: '8192' },
        { platform: 'linux', mem: 16384, expected: '8192' },
        { platform: 'linux', mem: 24575, expected: '8192' },
        { platform: 'win32', mem: 8192, expected: '8192' },
        { platform: 'win32', mem: 16384, expected: '8192' },
        { platform: 'win32', mem: 24575, expected: '8192' },
        { platform: 'darwin', mem: 8192, expected: '8192' },
        { platform: 'darwin', mem: 16384, expected: '8192' },
        { platform: 'darwin', mem: 24575, expected: '8192' },
      ] as const)('on $platform with $mem MiB -> $expected', ({ platform, mem, expected }) => {
        const result = resolveAutomaticLlamaCppContextSize(lowVramSnapshot, {
          platform,
          totalMemoryMiB: mem,
        });
        expect(result).toBe(expected);
      });
    });

    describe('Without Nvidia GPU (null snapshot or available: false)', () => {
      const unavailableSnapshot: NvidiaSmiSnapshot = {
        source: 'nvidia-smi',
        available: false,
        checkedAt: '2026-11-10T00:00:00.000Z',
        gpus: [],
      };

      it.each([null, undefined, unavailableSnapshot])('handles snapshot %s', snapshot => {
        // High RAM: always 32768 across all platforms
        expect(
          resolveAutomaticLlamaCppContextSize(snapshot, {
            platform: 'darwin',
            totalMemoryMiB: 32768,
          }),
        ).toBe('32768');
        expect(
          resolveAutomaticLlamaCppContextSize(snapshot, {
            platform: 'win32',
            totalMemoryMiB: 32768,
          }),
        ).toBe('32768');
        expect(
          resolveAutomaticLlamaCppContextSize(snapshot, {
            platform: 'linux',
            totalMemoryMiB: 32768,
          }),
        ).toBe('32768');

        // Low RAM (< 24GB): 8192 across all platforms
        expect(
          resolveAutomaticLlamaCppContextSize(snapshot, {
            platform: 'darwin',
            totalMemoryMiB: 16384,
          }),
        ).toBe('8192');
        expect(
          resolveAutomaticLlamaCppContextSize(snapshot, {
            platform: 'win32',
            totalMemoryMiB: 16384,
          }),
        ).toBe('8192');
        expect(
          resolveAutomaticLlamaCppContextSize(snapshot, {
            platform: 'linux',
            totalMemoryMiB: 16384,
          }),
        ).toBe('8192');

        // Unspecified RAM (undefined):
        // macOS Apple Silicon defaults to 32768
        expect(
          resolveAutomaticLlamaCppContextSize(snapshot, {
            platform: 'darwin',
            totalMemoryMiB: undefined,
          }),
        ).toBe('32768');
        // Win32 / Linux without Nvidia GPU defaults to 8192
        expect(
          resolveAutomaticLlamaCppContextSize(snapshot, {
            platform: 'win32',
            totalMemoryMiB: undefined,
          }),
        ).toBe('8192');
        expect(
          resolveAutomaticLlamaCppContextSize(snapshot, {
            platform: 'linux',
            totalMemoryMiB: undefined,
          }),
        ).toBe('8192');
      });
    });
  });
});
