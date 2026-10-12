import { describe, expect, test } from 'vitest';

import { validatePasswordChange } from './PasswordChangeForm.js';

describe('validatePasswordChange', () => {
  test('requires every password field', () => {
    expect(validatePasswordChange('', 'new-password-123', 'new-password-123')).toBe(
      'passwordFieldsRequired',
    );
  });

  test('enforces the AEP minimum password length', () => {
    expect(validatePasswordChange('old-password', 'too-short', 'too-short')).toBe(
      'passwordTooShort',
    );
  });

  test('rejects mismatched and unchanged passwords', () => {
    expect(validatePasswordChange('old-password', 'new-password-123', 'different-123')).toBe(
      'passwordMismatch',
    );
    expect(validatePasswordChange('same-password', 'same-password', 'same-password')).toBe(
      'passwordUnchanged',
    );
  });

  test('accepts a valid change', () => {
    expect(
      validatePasswordChange('old-password', 'new-password-123', 'new-password-123'),
    ).toBeNull();
  });
});
