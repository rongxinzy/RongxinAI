import { Alert, AlertDescription } from '@shared/components/ui/alert';
import { Field, FieldError, FieldGroup, FieldLabel } from '@shared/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@shared/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Eye, EyeOff, Info, X } from 'lucide-react';

import { i18nService } from '../../../services/i18n';
import {
  EMAIL_PROVIDER_ORDER,
  EMAIL_PROVIDER_PRESETS,
  EmailProvider,
  type EmailValidationCode,
} from './constants';
import type { EmailFormState, EmailValidationErrors } from './types';

interface EmailAccountFieldsProps {
  form: EmailFormState;
  errors: EmailValidationErrors;
  showPassword: boolean;
  onChange: (patch: Partial<EmailFormState>) => void;
  onProviderChange: (provider: EmailProvider) => void;
  onTogglePassword: () => void;
  resolveError: (code: EmailValidationCode | undefined) => string | undefined;
}

const RequiredMark = () => <span className="text-destructive">*</span>;

export function EmailAccountFields({
  form,
  errors,
  showPassword,
  onChange,
  onProviderChange,
  onTogglePassword,
  resolveError,
}: EmailAccountFieldsProps) {
  const currentPreset = form.provider ? EMAIL_PROVIDER_PRESETS[form.provider] : null;
  const hintKey = currentPreset && 'hintKey' in currentPreset ? currentPreset.hintKey : undefined;
  const providerItems = EMAIL_PROVIDER_ORDER.map(provider => ({
    label:
      provider === EmailProvider.Custom
        ? i18nService.t('emailCustomProvider')
        : i18nService.t(EMAIL_PROVIDER_PRESETS[provider].labelKey),
    value: provider,
  }));

  return (
    <div className="flex flex-col gap-4">
      <FieldGroup className="gap-4">
        <Field data-invalid={Boolean(errors.provider) || undefined}>
          <FieldLabel htmlFor="email-provider">
            {i18nService.t('emailProvider')}
            <RequiredMark />
          </FieldLabel>
          <Select
            items={providerItems}
            value={form.provider || null}
            onValueChange={value => onProviderChange(value ?? EmailProvider.Unselected)}
          >
            <SelectTrigger
              id="email-provider"
              className="w-full"
              aria-invalid={Boolean(errors.provider)}
            >
              <SelectValue placeholder={i18nService.t('emailSelectProvider')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {providerItems.map(item => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldError>{resolveError(errors.provider)}</FieldError>
        </Field>

        <Field data-invalid={Boolean(errors.email) || undefined}>
          <FieldLabel htmlFor="email-address">
            {i18nService.t('emailAddress')}
            <RequiredMark />
          </FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="email-address"
              type="email"
              value={form.email}
              onChange={event => onChange({ email: event.target.value })}
              placeholder={i18nService.t('emailAddressPlaceholder')}
              autoComplete="email"
              aria-invalid={Boolean(errors.email)}
            />
            {form.email && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  onClick={() => onChange({ email: '' })}
                  aria-label={i18nService.t('clear')}
                >
                  <X />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
          <FieldError>{resolveError(errors.email)}</FieldError>
        </Field>

        <Field data-invalid={Boolean(errors.password) || undefined}>
          <FieldLabel htmlFor="email-password">
            {i18nService.t('emailPassword')}
            <RequiredMark />
          </FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="email-password"
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={event => onChange({ password: event.target.value })}
              placeholder={i18nService.t('emailPasswordPlaceholder')}
              autoComplete="current-password"
              aria-invalid={Boolean(errors.password)}
            />
            <InputGroupAddon align="inline-end">
              {form.password && (
                <InputGroupButton
                  size="icon-xs"
                  onClick={() => onChange({ password: '' })}
                  aria-label={i18nService.t('clear')}
                >
                  <X />
                </InputGroupButton>
              )}
              <InputGroupButton
                size="icon-xs"
                onClick={onTogglePassword}
                aria-label={showPassword ? i18nService.t('hide') : i18nService.t('show')}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <FieldError>{resolveError(errors.password)}</FieldError>
        </Field>
      </FieldGroup>

      {hintKey && (
        <Alert>
          <Info />
          <AlertDescription>{i18nService.t(hintKey)}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
