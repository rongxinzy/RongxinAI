import { Alert, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { Spinner } from '@shared/components/ui/spinner';
import { CircleAlert } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { i18nService } from '../../../services/i18n';
import { skillService } from '../../../services/skill';
import {
  EmailProvider,
  EmailSkill,
  EmailValidationCode,
  type EmailValidationCode as EmailValidationCodeType,
} from './constants';
import { EmailAccountFields } from './EmailAccountFields';
import { EmailAdvancedFields } from './EmailAdvancedFields';
import { EmailConnectivitySection } from './EmailConnectivitySection';
import {
  applyEmailProviderPreset,
  buildEmailDiagnosticsPrompt,
  emailConfigsEqual,
  normalizeEmailConfig,
  serializeEmailConfig,
  validateEmailForm,
} from './emailConfig';
import type {
  EmailConnectivityTestResult,
  EmailFormState,
  EmailSettingsHandle,
  EmailValidationErrors,
} from './types';

const hasErrors = (errors: EmailValidationErrors): boolean => Object.keys(errors).length > 0;

const hasAdvancedErrors = (errors: EmailValidationErrors): boolean =>
  Boolean(errors.imapHost || errors.imapPort || errors.smtpHost || errors.smtpPort);

const resolveValidationError = (code: EmailValidationCodeType | undefined): string | undefined => {
  if (code === EmailValidationCode.Required) return i18nService.t('emailRequiredField');
  if (code === EmailValidationCode.InvalidAddress) return i18nService.t('emailInvalidEmail');
  if (code === EmailValidationCode.InvalidPort) return i18nService.t('emailInvalidPort');
  return undefined;
};

export const EmailSettingsPage = forwardRef<EmailSettingsHandle>(
  function EmailSettingsPage(_, ref) {
    const emptyForm = normalizeEmailConfig({});
    const [form, setForm] = useState<EmailFormState>(emptyForm);
    const [loading, setLoading] = useState(true);
    const [showPassword, setShowPassword] = useState(false);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [errors, setErrors] = useState<EmailValidationErrors>({});
    const [saveError, setSaveError] = useState<string | null>(null);
    const [isTesting, setIsTesting] = useState(false);
    const [connectivityResult, setConnectivityResult] =
      useState<EmailConnectivityTestResult | null>(null);
    const [connectivityError, setConnectivityError] = useState<string | null>(null);

    const formRef = useRef(form);
    const initialFormRef = useRef(form);
    const loadedRef = useRef(false);
    const saveInFlightRef = useRef<Promise<boolean> | null>(null);

    useEffect(() => {
      let cancelled = false;
      const loadConfig = async () => {
        const config = await skillService.getSkillConfig(EmailSkill.Id);
        if (cancelled) return;
        const nextForm = normalizeEmailConfig(config);
        formRef.current = nextForm;
        initialFormRef.current = nextForm;
        loadedRef.current = true;
        setForm(nextForm);
        setLoading(false);
      };
      void loadConfig();
      return () => {
        cancelled = true;
      };
    }, []);

    const updateForm = useCallback((patch: Partial<EmailFormState>) => {
      setForm(current => {
        const next = { ...current, ...patch };
        formRef.current = next;
        return next;
      });
      setErrors({});
      setSaveError(null);
      setConnectivityResult(null);
      setConnectivityError(null);
    }, []);

    const handleProviderChange = useCallback((provider: EmailProvider) => {
      setForm(current => {
        const next = applyEmailProviderPreset(current, provider);
        formRef.current = next;
        return next;
      });
      if (provider === EmailProvider.Custom) setAdvancedOpen(true);
      setErrors({});
      setSaveError(null);
      setConnectivityResult(null);
      setConnectivityError(null);
    }, []);

    const saveIfDirty = useCallback(async (): Promise<boolean> => {
      if (!loadedRef.current) {
        return true;
      }
      if (saveInFlightRef.current) return saveInFlightRef.current;

      const currentForm = formRef.current;
      if (emailConfigsEqual(currentForm, initialFormRef.current)) return true;

      const nextErrors = validateEmailForm(currentForm);
      setErrors(nextErrors);
      if (hasErrors(nextErrors)) {
        if (hasAdvancedErrors(nextErrors)) setAdvancedOpen(true);
        setSaveError(i18nService.t('emailValidationError'));
        return false;
      }

      setSaveError(null);
      const configSnapshot = serializeEmailConfig(currentForm);
      const formSnapshot = { ...currentForm };
      const savePromise = skillService
        .setSkillConfig(EmailSkill.Id, configSnapshot)
        .then(success => {
          if (success) {
            initialFormRef.current = formSnapshot;
            return true;
          }
          setSaveError(i18nService.t('emailConfigError'));
          return false;
        });
      saveInFlightRef.current = savePromise;
      try {
        return await savePromise;
      } finally {
        saveInFlightRef.current = null;
      }
    }, []);

    useImperativeHandle(ref, () => ({ saveIfDirty }), [saveIfDirty]);

    const handleConnectivityTest = useCallback(async () => {
      const currentForm = formRef.current;
      const nextErrors = validateEmailForm(currentForm);
      setErrors(nextErrors);
      if (hasErrors(nextErrors)) {
        if (hasAdvancedErrors(nextErrors)) setAdvancedOpen(true);
        return;
      }

      setConnectivityError(null);
      setConnectivityResult(null);
      setIsTesting(true);
      try {
        const result = await skillService.testEmailConnectivity(
          EmailSkill.Id,
          serializeEmailConfig(currentForm),
        );
        if (result) {
          setConnectivityResult(result as EmailConnectivityTestResult);
        } else {
          setConnectivityError(i18nService.t('connectionFailed'));
        }
      } finally {
        setIsTesting(false);
      }
    }, []);

    const handleAskAI = useCallback(
      (result: EmailConnectivityTestResult | null, genericError: string | null) => {
        const prompt = buildEmailDiagnosticsPrompt(formRef.current, result, genericError, key =>
          i18nService.t(key),
        );
        window.dispatchEvent(new CustomEvent('app:ask-ai', { detail: prompt }));
      },
      [],
    );

    if (loading) {
      return (
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          <span>{i18nService.t('loading')}</span>
        </div>
      );
    }

    const canTest = !hasErrors(validateEmailForm(form));

    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        {saveError && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>{i18nService.t('emailSaveError')}</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}

        <EmailAccountFields
          form={form}
          errors={errors}
          showPassword={showPassword}
          onChange={updateForm}
          onProviderChange={handleProviderChange}
          onTogglePassword={() => setShowPassword(current => !current)}
          resolveError={resolveValidationError}
        />

        <EmailAdvancedFields
          form={form}
          errors={errors}
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
          onChange={updateForm}
          resolveError={resolveValidationError}
        />

        <EmailConnectivitySection
          canTest={canTest}
          isTesting={isTesting}
          result={connectivityResult}
          error={connectivityError}
          onTest={() => void handleConnectivityTest()}
          onAskAI={handleAskAI}
        />
      </div>
    );
  },
);
