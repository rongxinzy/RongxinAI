import type {
  EmailConnectivityCheckCode,
  EmailConnectivityLevel,
  EmailConnectivityVerdict,
  EmailField,
  EmailProvider,
  EmailValidationCode,
} from './constants';

export interface EmailFormState {
  provider: EmailProvider;
  email: string;
  password: string;
  imapHost: string;
  imapPort: string;
  imapTls: boolean;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  rejectUnauthorized: boolean;
  mailbox: string;
}

export interface EmailConnectivityCheck {
  code: EmailConnectivityCheckCode;
  level: EmailConnectivityLevel;
  message: string;
  durationMs: number;
}

export interface EmailConnectivityTestResult {
  testedAt: number;
  verdict: EmailConnectivityVerdict;
  checks: EmailConnectivityCheck[];
}

export type EmailValidationErrors = Partial<Record<EmailField, EmailValidationCode>>;

export interface EmailSettingsHandle {
  saveIfDirty: () => Promise<boolean>;
}
