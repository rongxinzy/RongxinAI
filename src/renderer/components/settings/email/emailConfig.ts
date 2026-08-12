import { isValidEmail } from '../../../utils/validation';
import {
  EMAIL_PROVIDER_PRESETS,
  EmailBooleanValue,
  EmailConfigKey,
  EmailConnectivityCheckCode,
  EmailConnectivityLevel,
  EmailField,
  EmailProvider,
  EmailValidationCode,
} from './constants';
import type { EmailConnectivityTestResult, EmailFormState, EmailValidationErrors } from './types';

const DEFAULT_FORM: EmailFormState = {
  provider: EmailProvider.Unselected,
  email: '',
  password: '',
  imapHost: '',
  imapPort: '993',
  imapTls: true,
  smtpHost: '',
  smtpPort: '587',
  smtpSecure: false,
  rejectUnauthorized: true,
  mailbox: 'INBOX',
};

const isTrue = (value: string | undefined, fallback: boolean): boolean => {
  if (value == null) return fallback;
  return value === EmailBooleanValue.True;
};

const toConfigBoolean = (value: boolean): string =>
  value ? EmailBooleanValue.True : EmailBooleanValue.False;

export const detectEmailProvider = (imapHost: string): EmailProvider => {
  const host = imapHost.trim().toLowerCase();
  if (!host) return EmailProvider.Unselected;
  if (host.includes('gmail')) return EmailProvider.Gmail;
  if (host.includes('outlook') || host.includes('office365')) return EmailProvider.Outlook;
  if (host === 'imap.163.com') return EmailProvider.NetEase163;
  if (host === 'imap.126.com') return EmailProvider.NetEase126;
  if (host.includes('qq.com')) return EmailProvider.QQ;
  return EmailProvider.Custom;
};

export const normalizeEmailConfig = (config: Partial<Record<string, string>>): EmailFormState => {
  const imapHost = config[EmailConfigKey.ImapHost] ?? DEFAULT_FORM.imapHost;
  return {
    provider: detectEmailProvider(imapHost),
    email: config[EmailConfigKey.ImapUser] ?? DEFAULT_FORM.email,
    password: config[EmailConfigKey.ImapPassword] ?? DEFAULT_FORM.password,
    imapHost,
    imapPort: config[EmailConfigKey.ImapPort] ?? DEFAULT_FORM.imapPort,
    imapTls: isTrue(config[EmailConfigKey.ImapTls], DEFAULT_FORM.imapTls),
    smtpHost: config[EmailConfigKey.SmtpHost] ?? DEFAULT_FORM.smtpHost,
    smtpPort: config[EmailConfigKey.SmtpPort] ?? DEFAULT_FORM.smtpPort,
    smtpSecure: isTrue(config[EmailConfigKey.SmtpSecure], DEFAULT_FORM.smtpSecure),
    rejectUnauthorized: isTrue(
      config[EmailConfigKey.ImapRejectUnauthorized],
      DEFAULT_FORM.rejectUnauthorized,
    ),
    mailbox: config[EmailConfigKey.ImapMailbox] ?? DEFAULT_FORM.mailbox,
  };
};

export const serializeEmailConfig = (form: EmailFormState): Record<string, string> => ({
  [EmailConfigKey.ImapHost]: form.imapHost.trim(),
  [EmailConfigKey.ImapPort]: form.imapPort.trim(),
  [EmailConfigKey.ImapUser]: form.email.trim(),
  [EmailConfigKey.ImapPassword]: form.password,
  [EmailConfigKey.ImapTls]: toConfigBoolean(form.imapTls),
  [EmailConfigKey.ImapRejectUnauthorized]: toConfigBoolean(form.rejectUnauthorized),
  [EmailConfigKey.ImapMailbox]: form.mailbox.trim() || DEFAULT_FORM.mailbox,
  [EmailConfigKey.SmtpHost]: form.smtpHost.trim(),
  [EmailConfigKey.SmtpPort]: form.smtpPort.trim(),
  [EmailConfigKey.SmtpSecure]: toConfigBoolean(form.smtpSecure),
  [EmailConfigKey.SmtpUser]: form.email.trim(),
  [EmailConfigKey.SmtpPassword]: form.password,
  [EmailConfigKey.SmtpFrom]: form.email.trim(),
  [EmailConfigKey.SmtpRejectUnauthorized]: toConfigBoolean(form.rejectUnauthorized),
});

export const applyEmailProviderPreset = (
  form: EmailFormState,
  provider: EmailProvider,
): EmailFormState => {
  if (provider === EmailProvider.Unselected) {
    return { ...form, provider };
  }
  const preset = EMAIL_PROVIDER_PRESETS[provider];
  return {
    ...form,
    provider,
    imapHost: preset.imapHost,
    imapPort: preset.imapPort,
    imapTls: true,
    smtpHost: preset.smtpHost,
    smtpPort: preset.smtpPort,
    smtpSecure: preset.smtpSecure,
  };
};

const isValidPort = (value: string): boolean => {
  if (!/^\d+$/.test(value)) return false;
  const port = Number(value);
  return port >= 1 && port <= 65535;
};

export const validateEmailForm = (form: EmailFormState): EmailValidationErrors => {
  const errors: EmailValidationErrors = {};
  if (!form.provider) errors[EmailField.Provider] = EmailValidationCode.Required;
  if (!form.email.trim()) {
    errors[EmailField.Address] = EmailValidationCode.Required;
  } else if (!isValidEmail(form.email.trim())) {
    errors[EmailField.Address] = EmailValidationCode.InvalidAddress;
  }
  if (!form.password) errors[EmailField.Password] = EmailValidationCode.Required;
  if (!form.imapHost.trim()) errors[EmailField.ImapHost] = EmailValidationCode.Required;
  if (!form.imapPort.trim()) {
    errors[EmailField.ImapPort] = EmailValidationCode.Required;
  } else if (!isValidPort(form.imapPort.trim())) {
    errors[EmailField.ImapPort] = EmailValidationCode.InvalidPort;
  }
  if (!form.smtpHost.trim()) errors[EmailField.SmtpHost] = EmailValidationCode.Required;
  if (!form.smtpPort.trim()) {
    errors[EmailField.SmtpPort] = EmailValidationCode.Required;
  } else if (!isValidPort(form.smtpPort.trim())) {
    errors[EmailField.SmtpPort] = EmailValidationCode.InvalidPort;
  }
  return errors;
};

export const emailConfigsEqual = (left: EmailFormState, right: EmailFormState): boolean => {
  const leftConfig = serializeEmailConfig(left);
  const rightConfig = serializeEmailConfig(right);
  return Object.keys(leftConfig).every(key => leftConfig[key] === rightConfig[key]);
};

export const getEmailProviderLabel = (
  provider: EmailProvider,
  translate: (key: string) => string,
): string => {
  if (provider === EmailProvider.Custom || provider === EmailProvider.Unselected) {
    return translate('emailCustomProvider');
  }
  return translate(EMAIL_PROVIDER_PRESETS[provider].labelKey);
};

export const buildEmailDiagnosticsPrompt = (
  form: EmailFormState,
  result: EmailConnectivityTestResult | null,
  genericError: string | null,
  translate: (key: string) => string,
): string => {
  const lines = [translate('emailDiagnosticsPromptIntro'), ''];
  lines.push(
    `${translate('emailDiagnosticsProviderLabel')}: ${getEmailProviderLabel(form.provider, translate)}`,
  );
  if (form.email) lines.push(`${translate('emailAddress')}: ${form.email}`);
  if (form.imapHost) {
    lines.push(
      `${translate('emailDiagnosticsImapServerLabel')}: ${form.imapHost}:${form.imapPort}`,
    );
  }
  if (form.smtpHost) {
    lines.push(
      `${translate('emailDiagnosticsSmtpServerLabel')}: ${form.smtpHost}:${form.smtpPort}`,
    );
  }
  lines.push('', translate('emailDiagnosticsFailureDetails'));

  if (result) {
    result.checks.forEach(check => {
      const protocol =
        check.code === EmailConnectivityCheckCode.Imap
          ? translate('emailDiagnosticsImapLabel')
          : translate('emailDiagnosticsSmtpLabel');
      const status =
        check.level === EmailConnectivityLevel.Pass
          ? translate('emailDiagnosticsSucceeded')
          : translate('emailDiagnosticsFailed');
      lines.push(
        `- ${protocol} ${status}: ${check.message} (${translate('emailDiagnosticsDuration')} ${check.durationMs} ${translate('emailMillisecondsUnit')})`,
      );
    });
  } else if (genericError) {
    lines.push(`- ${genericError}`);
  }
  return lines.join('\n');
};
