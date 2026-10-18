import { describe, expect, test, vi } from 'vitest';

import {
  LEGACY_COPILOT_GITHUB_TOKEN_KEY,
  cleanupLegacyCopilotStoredToken,
} from './legacyCredentialCleanup';

describe('cleanupLegacyCopilotStoredToken', () => {
  test('deletes the stored legacy Copilot token when present', () => {
    const store = {
      get: vi.fn().mockReturnValue('gho_legacytoken'),
      delete: vi.fn(),
    };

    cleanupLegacyCopilotStoredToken(store);

    expect(store.get).toHaveBeenCalledWith(LEGACY_COPILOT_GITHUB_TOKEN_KEY);
    expect(store.delete).toHaveBeenCalledWith(LEGACY_COPILOT_GITHUB_TOKEN_KEY);
  });

  test('leaves the store untouched when the key is absent', () => {
    const store = {
      get: vi.fn().mockReturnValue(undefined),
      delete: vi.fn(),
    };

    cleanupLegacyCopilotStoredToken(store);

    expect(store.get).toHaveBeenCalledWith(LEGACY_COPILOT_GITHUB_TOKEN_KEY);
    expect(store.delete).not.toHaveBeenCalled();
  });
});
