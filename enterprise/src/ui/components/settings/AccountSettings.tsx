import { CircleAlert } from 'lucide-react';

import type { EnterpriseSessionIdentity } from '../../../host-contract.js';
import type { EnterpriseRendererLanguage } from '../../../renderer-contract.js';
import { type TranslationKey, translate } from '../../i18n.js';
import { PasswordChangeForm } from '../session/PasswordChangeForm.js';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert.js';
import { Separator } from '../ui/separator.js';

interface AccountSettingsProps {
  readonly language: EnterpriseRendererLanguage;
  readonly identity: EnterpriseSessionIdentity;
  readonly pending: boolean;
  readonly signingOut: boolean;
  readonly error: TranslationKey | null;
  readonly success: TranslationKey | null;
  readonly onPasswordChange: (input: {
    currentPassword: string;
    newPassword: string;
  }) => Promise<boolean>;
  readonly onSignOut: () => Promise<void>;
}

export function AccountSettings({
  language,
  identity,
  pending,
  signingOut,
  error,
  success,
  onPasswordChange,
  onSignOut,
}: AccountSettingsProps) {
  const details = [
    [translate(language, 'user'), identity.user.displayName],
    [translate(language, 'email'), identity.user.email || translate(language, 'notProvided')],
    [translate(language, 'enterprise'), identity.enterprise.name],
    [translate(language, 'enterpriseIdentifier'), identity.enterprise.id],
    [
      translate(language, 'roles'),
      identity.roles.length > 0 ? identity.roles.join(', ') : translate(language, 'noRoles'),
    ],
    [
      translate(language, 'sessionExpiresAt'),
      formatSessionExpiry(identity.sessionExpiresAt, language),
    ],
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4" aria-labelledby="account-details-heading">
        <h2 id="account-details-heading" className="text-sm font-semibold">
          {translate(language, 'accountDetails')}
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {details.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-tertiary-foreground">{label}</dt>
              <dd className="break-words text-sm font-normal">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Separator />

      <section className="flex flex-col gap-4" aria-labelledby="password-security-heading">
        <div className="flex flex-col gap-1">
          <h2 id="password-security-heading" className="text-sm font-semibold">
            {translate(language, 'passwordSecurity')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {translate(language, 'passwordSecurityDescription')}
          </p>
        </div>
        <PasswordChangeForm
          language={language}
          pending={pending}
          signingOut={signingOut}
          error={error}
          success={success}
          submitLabel="changePassword"
          signOutLabel="accountSignOut"
          autoFocus={false}
          compact
          onSubmit={onPasswordChange}
          onSignOut={onSignOut}
        />
      </section>
    </div>
  );
}

export function AccountSettingsUnavailable({
  language,
}: {
  readonly language: EnterpriseRendererLanguage;
}) {
  return (
    <main className="h-full overflow-y-auto bg-background px-4 py-4 sm:px-6">
      <Alert variant="warning">
        <CircleAlert aria-hidden="true" />
        <AlertTitle>{translate(language, 'accountUnavailableTitle')}</AlertTitle>
        <AlertDescription>{translate(language, 'accountUnavailableDescription')}</AlertDescription>
      </Alert>
    </main>
  );
}

function formatSessionExpiry(value: string, language: EnterpriseRendererLanguage): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
