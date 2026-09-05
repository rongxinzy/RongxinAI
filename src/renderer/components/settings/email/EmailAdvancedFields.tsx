import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@shared/components/ui/collapsible';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@shared/components/ui/field';
import { Input } from '@shared/components/ui/input';
import { Switch } from '@shared/components/ui/switch';
import { cn } from '@shared/lib/utils';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';

import { i18nService } from '../../../services/i18n';
import type { EmailValidationCode } from './constants';
import type { EmailFormState, EmailValidationErrors } from './types';

interface EmailAdvancedFieldsProps {
  form: EmailFormState;
  errors: EmailValidationErrors;
  open: boolean;
  onChange: (patch: Partial<EmailFormState>) => void;
  onOpenChange: (open: boolean) => void;
  resolveError: (code: EmailValidationCode | undefined) => string | undefined;
}

const RequiredMark = () => <span className="text-destructive">*</span>;

export function EmailAdvancedFields({
  form,
  errors,
  open,
  onChange,
  onOpenChange,
  resolveError,
}: EmailAdvancedFieldsProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="flex flex-col gap-4">
      <CollapsibleTrigger className="theme-fold-settings flex w-full items-center gap-2">
        <SlidersHorizontal className="size-4 text-muted-foreground" />
        <span className="flex-1 text-left">{i18nService.t('emailAdvancedSettings')}</span>
        <ChevronDown
          className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="flex flex-col gap-6 px-1 pb-1">
        <FieldSet>
          <FieldLegend variant="label">{i18nService.t('emailImapSmtpConfig')}</FieldLegend>
          <FieldDescription>{i18nService.t('emailServerConfigDescription')}</FieldDescription>
          <FieldGroup className="gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(errors.imapHost) || undefined}>
                <FieldLabel htmlFor="email-imap-host">
                  {i18nService.t('emailImapHost')}
                  <RequiredMark />
                </FieldLabel>
                <Input
                  id="email-imap-host"
                  value={form.imapHost}
                  onChange={event => onChange({ imapHost: event.target.value })}
                  placeholder={i18nService.t('emailImapHostPlaceholder')}
                  spellCheck={false}
                  aria-invalid={Boolean(errors.imapHost)}
                />
                <FieldError>{resolveError(errors.imapHost)}</FieldError>
              </Field>

              <Field data-invalid={Boolean(errors.imapPort) || undefined}>
                <FieldLabel htmlFor="email-imap-port">
                  {i18nService.t('emailImapPort')}
                  <RequiredMark />
                </FieldLabel>
                <Input
                  id="email-imap-port"
                  value={form.imapPort}
                  onChange={event => onChange({ imapPort: event.target.value })}
                  placeholder={i18nService.t('emailImapPortPlaceholder')}
                  inputMode="numeric"
                  aria-invalid={Boolean(errors.imapPort)}
                />
                <FieldError>{resolveError(errors.imapPort)}</FieldError>
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(errors.smtpHost) || undefined}>
                <FieldLabel htmlFor="email-smtp-host">
                  {i18nService.t('emailSmtpHost')}
                  <RequiredMark />
                </FieldLabel>
                <Input
                  id="email-smtp-host"
                  value={form.smtpHost}
                  onChange={event => onChange({ smtpHost: event.target.value })}
                  placeholder={i18nService.t('emailSmtpHostPlaceholder')}
                  spellCheck={false}
                  aria-invalid={Boolean(errors.smtpHost)}
                />
                <FieldError>{resolveError(errors.smtpHost)}</FieldError>
              </Field>

              <Field data-invalid={Boolean(errors.smtpPort) || undefined}>
                <FieldLabel htmlFor="email-smtp-port">
                  {i18nService.t('emailSmtpPort')}
                  <RequiredMark />
                </FieldLabel>
                <Input
                  id="email-smtp-port"
                  value={form.smtpPort}
                  onChange={event => onChange({ smtpPort: event.target.value })}
                  placeholder={i18nService.t('emailSmtpPortPlaceholder')}
                  inputMode="numeric"
                  aria-invalid={Boolean(errors.smtpPort)}
                />
                <FieldError>{resolveError(errors.smtpPort)}</FieldError>
              </Field>
            </div>
          </FieldGroup>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">{i18nService.t('emailSecuritySettings')}</FieldLegend>
          <FieldGroup className="gap-3">
            <Field orientation="horizontal" className="rounded-lg border border-border p-3">
              <FieldContent>
                <FieldLabel htmlFor="email-imap-tls">{i18nService.t('emailImapTls')}</FieldLabel>
                <FieldDescription>{i18nService.t('emailImapTlsDescription')}</FieldDescription>
              </FieldContent>
              <Switch
                id="email-imap-tls"
                checked={form.imapTls}
                onCheckedChange={checked => onChange({ imapTls: checked })}
              />
            </Field>

            <Field orientation="horizontal" className="rounded-lg border border-border p-3">
              <FieldContent>
                <FieldLabel htmlFor="email-smtp-ssl">{i18nService.t('emailSmtpSsl')}</FieldLabel>
                <FieldDescription>{i18nService.t('emailSmtpSslDescription')}</FieldDescription>
              </FieldContent>
              <Switch
                id="email-smtp-ssl"
                checked={form.smtpSecure}
                onCheckedChange={checked => onChange({ smtpSecure: checked })}
              />
            </Field>

            <Field orientation="horizontal" className="rounded-lg border border-border p-3">
              <FieldContent>
                <FieldLabel htmlFor="email-insecure-cert">
                  {i18nService.t('emailAllowInsecureCert')}
                </FieldLabel>
                <FieldDescription>{i18nService.t('emailAllowInsecureCertHint')}</FieldDescription>
              </FieldContent>
              <Switch
                id="email-insecure-cert"
                checked={!form.rejectUnauthorized}
                onCheckedChange={checked => onChange({ rejectUnauthorized: !checked })}
              />
            </Field>
          </FieldGroup>
        </FieldSet>

        <Field>
          <FieldLabel htmlFor="email-mailbox">{i18nService.t('emailMailbox')}</FieldLabel>
          <Input
            id="email-mailbox"
            value={form.mailbox}
            onChange={event => onChange({ mailbox: event.target.value })}
            placeholder={i18nService.t('emailMailboxPlaceholder')}
            spellCheck={false}
          />
          <FieldDescription>{i18nService.t('emailMailboxDescription')}</FieldDescription>
        </Field>
      </CollapsibleContent>
    </Collapsible>
  );
}
