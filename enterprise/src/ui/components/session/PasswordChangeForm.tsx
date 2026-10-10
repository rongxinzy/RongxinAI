import { CircleAlert, CircleCheck, KeyRound, LogOut } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import type { EnterpriseRendererLanguage } from '../../../renderer-contract.js';
import { type TranslationKey, translate } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { Alert, AlertDescription } from '../ui/alert.js';
import { Button } from '../ui/button.js';
import { Field, FieldError, FieldGroup, FieldLabel } from '../ui/field.js';
import { Input } from '../ui/input.js';
import { Spinner } from '../ui/spinner.js';

interface PasswordChangeFormProps {
  readonly language: EnterpriseRendererLanguage;
  readonly pending: boolean;
  readonly signingOut: boolean;
  readonly error: TranslationKey | null;
  readonly success: TranslationKey | null;
  readonly submitLabel?: TranslationKey;
  readonly signOutLabel?: TranslationKey;
  readonly autoFocus?: boolean;
  readonly compact?: boolean;
  readonly onSubmit: (input: { currentPassword: string; newPassword: string }) => Promise<boolean>;
  readonly onSignOut: () => Promise<void>;
}

export function PasswordChangeForm({
  language,
  pending,
  signingOut,
  error,
  success,
  submitLabel = 'updatePassword',
  signOutLabel = 'signOut',
  autoFocus = true,
  compact = false,
  onSubmit,
  onSignOut,
}: PasswordChangeFormProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [validationError, setValidationError] = useState<TranslationKey | null>(null);
  const disabled = pending || signingOut;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextError = validatePasswordChange(currentPassword, newPassword, confirmation);
    setValidationError(nextError);
    if (nextError) return;
    if (await onSubmit({ currentPassword, newPassword })) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
    }
  };

  const displayedError = validationError ?? error;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      {displayedError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{translate(language, displayedError)}</AlertDescription>
        </Alert>
      ) : null}
      {!displayedError && success ? (
        <Alert variant="success">
          <CircleCheck aria-hidden="true" />
          <AlertDescription>{translate(language, success)}</AlertDescription>
        </Alert>
      ) : null}
      <FieldGroup className={cn(compact && 'grid gap-4 sm:grid-cols-2')}>
        <Field
          className={cn(compact && 'sm:col-span-2')}
          data-invalid={displayedError ? true : undefined}
        >
          <FieldLabel htmlFor="current-password">
            {translate(language, 'currentPassword')}
          </FieldLabel>
          <Input
            id="current-password"
            name="currentPassword"
            type="password"
            value={currentPassword}
            onChange={event => setCurrentPassword(event.target.value)}
            placeholder={translate(language, 'currentPasswordPlaceholder')}
            autoComplete="current-password"
            maxLength={1024}
            disabled={disabled}
            aria-invalid={displayedError ? true : undefined}
            autoFocus={autoFocus}
          />
        </Field>
        <Field data-invalid={displayedError ? true : undefined}>
          <FieldLabel htmlFor="new-password">{translate(language, 'newPassword')}</FieldLabel>
          <Input
            id="new-password"
            name="newPassword"
            type="password"
            value={newPassword}
            onChange={event => setNewPassword(event.target.value)}
            placeholder={translate(language, 'newPasswordPlaceholder')}
            autoComplete="new-password"
            minLength={12}
            maxLength={1024}
            disabled={disabled}
            aria-invalid={displayedError ? true : undefined}
          />
        </Field>
        <Field data-invalid={displayedError ? true : undefined}>
          <FieldLabel htmlFor="confirm-password">
            {translate(language, 'confirmPassword')}
          </FieldLabel>
          <Input
            id="confirm-password"
            name="confirmPassword"
            type="password"
            value={confirmation}
            onChange={event => setConfirmation(event.target.value)}
            placeholder={translate(language, 'confirmPasswordPlaceholder')}
            autoComplete="new-password"
            minLength={12}
            maxLength={1024}
            disabled={disabled}
            aria-invalid={displayedError ? true : undefined}
          />
          {validationError ? <FieldError>{translate(language, validationError)}</FieldError> : null}
        </Field>
      </FieldGroup>
      <div className={cn('flex gap-2', compact ? 'flex-wrap' : 'flex-col')}>
        <Button
          type="submit"
          size={compact ? 'default' : 'lg'}
          disabled={disabled}
          className={cn(!compact && 'w-full')}
        >
          {pending ? <Spinner data-icon="inline-start" /> : <KeyRound data-icon="inline-start" />}
          {translate(language, pending ? 'updatingPassword' : submitLabel)}
        </Button>
        <Button
          type="button"
          size={compact ? 'default' : 'lg'}
          variant="ghost"
          disabled={disabled}
          className={cn(!compact && 'w-full')}
          onClick={() => void onSignOut()}
        >
          {signingOut ? <Spinner data-icon="inline-start" /> : <LogOut data-icon="inline-start" />}
          {translate(language, signingOut ? 'signingOut' : signOutLabel)}
        </Button>
      </div>
    </form>
  );
}

export function validatePasswordChange(
  currentPassword: string,
  newPassword: string,
  confirmation: string,
): TranslationKey | null {
  if (!currentPassword || !newPassword || !confirmation) return 'passwordFieldsRequired';
  if (newPassword.length < 12) return 'passwordTooShort';
  if (newPassword !== confirmation) return 'passwordMismatch';
  if (newPassword === currentPassword) return 'passwordUnchanged';
  return null;
}
