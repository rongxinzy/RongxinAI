import { describe, expect, test } from 'vitest';

import { CoworkPermissionMode } from '../cowork/constants';
import { ModelCapabilityStatus } from '../providers';
import {
  CoworkSessionContinueSchema,
  CoworkSessionStartSchema,
  ProviderModelDiscoverySchema,
} from './schemas';

describe('CoworkSessionStartSchema permissionMode', () => {
  const baseInput = { prompt: 'hello' };

  test('defaults to absent (main maps missing to Ask)', () => {
    const parsed = CoworkSessionStartSchema.input.parse(baseInput);
    expect(parsed.permissionMode).toBeUndefined();
  });

  test('accepts ask and allowAll', () => {
    expect(
      CoworkSessionStartSchema.input.parse({
        ...baseInput,
        permissionMode: CoworkPermissionMode.Ask,
      }).permissionMode,
    ).toBe(CoworkPermissionMode.Ask);
    expect(
      CoworkSessionStartSchema.input.parse({
        ...baseInput,
        permissionMode: CoworkPermissionMode.AllowAll,
      }).permissionMode,
    ).toBe(CoworkPermissionMode.AllowAll);
  });

  test('rejects unknown permission modes', () => {
    expect(() =>
      CoworkSessionStartSchema.input.parse({ ...baseInput, permissionMode: 'yolo' }),
    ).toThrow();
  });
});

describe('CoworkSessionContinueSchema permissionMode', () => {
  const baseInput = { sessionId: 'session-1', prompt: 'go on' };

  test('accepts allowAll so restarts can re-apply it', () => {
    const parsed = CoworkSessionContinueSchema.input.parse({
      ...baseInput,
      permissionMode: CoworkPermissionMode.AllowAll,
    });
    expect(parsed.permissionMode).toBe(CoworkPermissionMode.AllowAll);
  });

  test('rejects unknown permission modes', () => {
    expect(() =>
      CoworkSessionContinueSchema.input.parse({ ...baseInput, permissionMode: 'yolo' }),
    ).toThrow();
  });
});

describe.each([
  ['start', CoworkSessionStartSchema.input, { prompt: 'hello' }],
  ['continue', CoworkSessionContinueSchema.input, { sessionId: 'session-1', prompt: 'go on' }],
])('%s session expertIds', (_name, schema, baseInput) => {
  test('accepts zero or one expert', () => {
    expect(schema.parse(baseInput).expertIds).toBeUndefined();
    expect(schema.parse({ ...baseInput, expertIds: ['expert-a'] }).expertIds).toEqual(['expert-a']);
  });

  test('rejects multiple experts', () => {
    expect(() => schema.parse({ ...baseInput, expertIds: ['expert-a', 'expert-b'] })).toThrow();
  });
});

test('preserves discovered model metadata in the IPC response', () => {
  expect(
    ProviderModelDiscoverySchema.output.parse({
      success: true,
      models: [
        {
          id: 'Qwen3.6-35B-A3B-APEX-I-Compact',
          contextWindow: 262_144,
          maxTokens: 16_384,
          capabilities: {
            toolCalling: ModelCapabilityStatus.Supported,
            imageInput: ModelCapabilityStatus.Unsupported,
            reasoning: ModelCapabilityStatus.Supported,
          },
        },
      ],
    }),
  ).toEqual({
    success: true,
    models: [
      {
        id: 'Qwen3.6-35B-A3B-APEX-I-Compact',
        contextWindow: 262_144,
        maxTokens: 16_384,
        capabilities: {
          toolCalling: ModelCapabilityStatus.Supported,
          imageInput: ModelCapabilityStatus.Unsupported,
          reasoning: ModelCapabilityStatus.Supported,
        },
      },
    ],
  });
});
