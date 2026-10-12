import type { EnterpriseSessionIdentity } from '../../../host-contract.js';
import type { EnterpriseRendererLanguage } from '../../../renderer-contract.js';
import { type TranslationKey, translate } from '../../i18n.js';
import { AccountSettings } from './AccountSettings.js';

interface EnterpriseSettingsProps {
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

export function EnterpriseSettings({
  language,
  identity,
  pending,
  signingOut,
  error,
  success,
  onPasswordChange,
  onSignOut,
}: EnterpriseSettingsProps) {
  return (
    <main
      className="flex h-full flex-col gap-6 overflow-y-auto bg-background px-4 py-4 sm:px-6"
      aria-label={translate(language, 'accountTitle')}
    >
      <p className="text-sm text-muted-foreground">{translate(language, 'accountDescription')}</p>
      <AccountSettings
        language={language}
        identity={identity}
        pending={pending}
        signingOut={signingOut}
        error={error}
        success={success}
        onPasswordChange={onPasswordChange}
        onSignOut={onSignOut}
      />
    </main>
  );
}
