import { expect, test } from 'vitest';

import {
  EmailBooleanValue,
  EmailConfigKey,
  EmailField,
  EmailProvider,
  EmailValidationCode,
} from './constants';
import {
  applyEmailProviderPreset,
  detectEmailProvider,
  emailConfigsEqual,
  normalizeEmailConfig,
  serializeEmailConfig,
  validateEmailForm,
} from './emailConfig';

test('detects known providers and falls back to custom', () => {
  expect(detectEmailProvider('imap.gmail.com')).toBe(EmailProvider.Gmail);
  expect(detectEmailProvider('outlook.office365.com')).toBe(EmailProvider.Outlook);
  expect(detectEmailProvider('mail.example.com')).toBe(EmailProvider.Custom);
  expect(detectEmailProvider('')).toBe(EmailProvider.Unselected);
});

test('normalizes and serializes an email configuration without losing security settings', () => {
  const form = normalizeEmailConfig({
    [EmailConfigKey.ImapHost]: 'imap.example.com',
    [EmailConfigKey.ImapPort]: '993',
    [EmailConfigKey.ImapUser]: 'user@example.com',
    [EmailConfigKey.ImapPassword]: 'secret',
    [EmailConfigKey.ImapTls]: EmailBooleanValue.True,
    [EmailConfigKey.ImapRejectUnauthorized]: EmailBooleanValue.False,
    [EmailConfigKey.ImapMailbox]: 'Archive',
    [EmailConfigKey.SmtpHost]: 'smtp.example.com',
    [EmailConfigKey.SmtpPort]: '465',
    [EmailConfigKey.SmtpSecure]: EmailBooleanValue.True,
  });

  expect(form.provider).toBe(EmailProvider.Custom);
  expect(form.rejectUnauthorized).toBe(false);
  expect(serializeEmailConfig(form)).toMatchObject({
    [EmailConfigKey.SmtpUser]: 'user@example.com',
    [EmailConfigKey.SmtpPassword]: 'secret',
    [EmailConfigKey.SmtpFrom]: 'user@example.com',
    [EmailConfigKey.SmtpSecure]: EmailBooleanValue.True,
    [EmailConfigKey.SmtpRejectUnauthorized]: EmailBooleanValue.False,
  });
});

test('applies provider presets while preserving credentials', () => {
  const initial = normalizeEmailConfig({
    [EmailConfigKey.ImapUser]: 'user@example.com',
    [EmailConfigKey.ImapPassword]: 'secret',
  });
  const next = applyEmailProviderPreset(initial, EmailProvider.NetEase163);

  expect(next.email).toBe(initial.email);
  expect(next.password).toBe(initial.password);
  expect(next.imapHost).toBe('imap.163.com');
  expect(next.smtpPort).toBe('465');
  expect(next.smtpSecure).toBe(true);
});

test('validates required fields, addresses, and port ranges', () => {
  const empty = normalizeEmailConfig({});
  expect(validateEmailForm(empty)).toMatchObject({
    [EmailField.Provider]: EmailValidationCode.Required,
    [EmailField.Address]: EmailValidationCode.Required,
    [EmailField.Password]: EmailValidationCode.Required,
    [EmailField.ImapHost]: EmailValidationCode.Required,
    [EmailField.SmtpHost]: EmailValidationCode.Required,
  });

  const invalid = {
    ...applyEmailProviderPreset(empty, EmailProvider.Custom),
    email: 'invalid',
    password: 'secret',
    imapHost: 'imap.example.com',
    imapPort: '70000',
    smtpHost: 'smtp.example.com',
    smtpPort: 'abc',
  };
  expect(validateEmailForm(invalid)).toMatchObject({
    [EmailField.Address]: EmailValidationCode.InvalidAddress,
    [EmailField.ImapPort]: EmailValidationCode.InvalidPort,
    [EmailField.SmtpPort]: EmailValidationCode.InvalidPort,
  });
});

test('compares normalized serialized values', () => {
  const left = normalizeEmailConfig({
    [EmailConfigKey.ImapHost]: 'imap.gmail.com',
  });
  expect(emailConfigsEqual(left, { ...left })).toBe(true);
  expect(emailConfigsEqual(left, { ...left, mailbox: 'Archive' })).toBe(false);
});
