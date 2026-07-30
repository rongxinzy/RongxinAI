import { Alert, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { Button } from '@shared/components/ui/button';
import { Spinner } from '@shared/components/ui/spinner';
import { CheckCircle, CircleAlert, Signal, Sparkles, XCircle } from 'lucide-react';

import { i18nService } from '../../../services/i18n';
import {
  EmailConnectivityCheckCode,
  EmailConnectivityLevel,
  EmailConnectivityVerdict,
} from './constants';
import type { EmailConnectivityTestResult } from './types';

interface EmailConnectivitySectionProps {
  canTest: boolean;
  isTesting: boolean;
  result: EmailConnectivityTestResult | null;
  error: string | null;
  onTest: () => void;
  onAskAI: (result: EmailConnectivityTestResult | null, error: string | null) => void;
}

export function EmailConnectivitySection({
  canTest,
  isTesting,
  result,
  error,
  onTest,
  onAskAI,
}: EmailConnectivitySectionProps) {
  const passed = result?.verdict === EmailConnectivityVerdict.Pass;
  const locale = i18nService.getLanguage() === 'zh' ? 'zh-CN' : 'en-US';

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h4 className="text-sm font-medium text-foreground">
            {i18nService.t('emailConnectivityTitle')}
          </h4>
          <p className="text-sm text-muted-foreground">
            {i18nService.t('emailConnectivityDescription')}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onTest} disabled={isTesting || !canTest}>
          {isTesting ? <Spinner data-icon="inline-start" /> : <Signal data-icon="inline-start" />}
          {isTesting ? i18nService.t('imConnectivityTesting') : i18nService.t('imConnectivityTest')}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>{i18nService.t('emailConnectivityFailAlert')}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{error}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => onAskAI(null, error)}>
              <Sparkles data-icon="inline-start" />
              {i18nService.t('emailConnectivityAskAI')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {result && (
        <Alert variant={passed ? 'default' : 'destructive'}>
          {passed ? <CheckCircle className="text-success" /> : <XCircle />}
          <AlertTitle>
            {passed ? i18nService.t('connectionSuccess') : i18nService.t('connectionFailed')}
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>{new Date(result.testedAt).toLocaleString(locale)}</span>
            <div className="flex flex-col border-t border-border">
              {result.checks.map(check => {
                const checkPassed = check.level === EmailConnectivityLevel.Pass;
                const label =
                  check.code === EmailConnectivityCheckCode.Imap
                    ? i18nService.t('emailDiagnosticsImapLabel')
                    : i18nService.t('emailDiagnosticsSmtpLabel');
                return (
                  <div
                    key={check.code}
                    className="flex flex-col gap-1 border-b border-border py-2 last:border-b-0"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {checkPassed ? (
                        <CheckCircle className="size-4 text-success" />
                      ) : (
                        <XCircle className="size-4 text-destructive" />
                      )}
                      <span>{label}</span>
                      <span className="font-normal text-muted-foreground">
                        {check.durationMs} {i18nService.t('emailMillisecondsUnit')}
                      </span>
                    </div>
                    <span>{check.message}</span>
                  </div>
                );
              })}
            </div>
            {!passed && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => onAskAI(result, null)}
              >
                <Sparkles data-icon="inline-start" />
                {i18nService.t('emailConnectivityAskAI')}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
