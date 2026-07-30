export const EmailSkill = {
  Id: 'imap-smtp-email',
} as const;

export const EmailProvider = {
  Unselected: '',
  Gmail: 'gmail',
  Outlook: 'outlook',
  NetEase163: '163',
  NetEase126: '126',
  QQ: 'qq',
  Custom: 'custom',
} as const;
export type EmailProvider = (typeof EmailProvider)[keyof typeof EmailProvider];

export const EmailConfigKey = {
  ImapHost: 'IMAP_HOST',
  ImapPort: 'IMAP_PORT',
  ImapUser: 'IMAP_USER',
  ImapPassword: 'IMAP_PASS',
  ImapTls: 'IMAP_TLS',
  ImapRejectUnauthorized: 'IMAP_REJECT_UNAUTHORIZED',
  ImapMailbox: 'IMAP_MAILBOX',
  SmtpHost: 'SMTP_HOST',
  SmtpPort: 'SMTP_PORT',
  SmtpSecure: 'SMTP_SECURE',
  SmtpUser: 'SMTP_USER',
  SmtpPassword: 'SMTP_PASS',
  SmtpFrom: 'SMTP_FROM',
  SmtpRejectUnauthorized: 'SMTP_REJECT_UNAUTHORIZED',
} as const;
export type EmailConfigKey = (typeof EmailConfigKey)[keyof typeof EmailConfigKey];

export const EmailBooleanValue = {
  True: 'true',
  False: 'false',
} as const;

export const EmailConnectivityCheckCode = {
  Imap: 'imap_connection',
  Smtp: 'smtp_connection',
} as const;
export type EmailConnectivityCheckCode =
  (typeof EmailConnectivityCheckCode)[keyof typeof EmailConnectivityCheckCode];

export const EmailConnectivityLevel = {
  Pass: 'pass',
  Fail: 'fail',
} as const;
export type EmailConnectivityLevel =
  (typeof EmailConnectivityLevel)[keyof typeof EmailConnectivityLevel];

export const EmailConnectivityVerdict = {
  Pass: 'pass',
  Fail: 'fail',
} as const;
export type EmailConnectivityVerdict =
  (typeof EmailConnectivityVerdict)[keyof typeof EmailConnectivityVerdict];

export const EmailField = {
  Provider: 'provider',
  Address: 'email',
  Password: 'password',
  ImapHost: 'imapHost',
  ImapPort: 'imapPort',
  SmtpHost: 'smtpHost',
  SmtpPort: 'smtpPort',
} as const;
export type EmailField = (typeof EmailField)[keyof typeof EmailField];

export const EmailValidationCode = {
  Required: 'required',
  InvalidAddress: 'invalid_address',
  InvalidPort: 'invalid_port',
} as const;
export type EmailValidationCode = (typeof EmailValidationCode)[keyof typeof EmailValidationCode];

export interface EmailProviderPreset {
  labelKey: string;
  imapHost: string;
  imapPort: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  hintKey?: string;
}

export const EMAIL_PROVIDER_ORDER = [
  EmailProvider.Gmail,
  EmailProvider.Outlook,
  EmailProvider.NetEase163,
  EmailProvider.NetEase126,
  EmailProvider.QQ,
  EmailProvider.Custom,
] as const;

export const EMAIL_PROVIDER_PRESETS = {
  [EmailProvider.Gmail]: {
    labelKey: 'emailProviderGmail',
    imapHost: 'imap.gmail.com',
    imapPort: '993',
    smtpHost: 'smtp.gmail.com',
    smtpPort: '587',
    smtpSecure: false,
    hintKey: 'emailHintGmail',
  },
  [EmailProvider.Outlook]: {
    labelKey: 'emailProviderOutlook',
    imapHost: 'outlook.office365.com',
    imapPort: '993',
    smtpHost: 'smtp.office365.com',
    smtpPort: '587',
    smtpSecure: false,
  },
  [EmailProvider.NetEase163]: {
    labelKey: 'emailProvider163',
    imapHost: 'imap.163.com',
    imapPort: '993',
    smtpHost: 'smtp.163.com',
    smtpPort: '465',
    smtpSecure: true,
    hintKey: 'emailHint163',
  },
  [EmailProvider.NetEase126]: {
    labelKey: 'emailProvider126',
    imapHost: 'imap.126.com',
    imapPort: '993',
    smtpHost: 'smtp.126.com',
    smtpPort: '465',
    smtpSecure: true,
    hintKey: 'emailHint163',
  },
  [EmailProvider.QQ]: {
    labelKey: 'emailProviderQQ',
    imapHost: 'imap.qq.com',
    imapPort: '993',
    smtpHost: 'smtp.qq.com',
    smtpPort: '465',
    smtpSecure: true,
    hintKey: 'emailHintQQ',
  },
  [EmailProvider.Custom]: {
    labelKey: 'emailCustomProvider',
    imapHost: '',
    imapPort: '993',
    smtpHost: '',
    smtpPort: '587',
    smtpSecure: false,
  },
} satisfies Record<Exclude<EmailProvider, ''>, EmailProviderPreset>;
