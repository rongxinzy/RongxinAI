/**
 * Modal that shows IM connectivity test results per platform.
 * Extracted from IMSettings.tsx (issue #1069).
 */
import { Alert, AlertTitle } from '@shared/components/ui/alert';
import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { DialogTitle } from '@shared/components/ui/dialog';
import { Spinner } from '@shared/components/ui/spinner';
import type { Platform } from '@shared/platform';
import { CheckCircle, TriangleAlert, X, XCircle } from 'lucide-react';
import React from 'react';

import { i18nService } from '../../../services/i18n';
import type { IMConnectivityCheck, IMConnectivityTestResult } from '../../../types/im';
import Modal from '../../common/Modal';

interface ConnectivityResultModalProps {
  platform: Platform;
  result: IMConnectivityTestResult | undefined;
  failed: boolean;
  testing: boolean;
  onClose: () => void;
}

const getCheckTitle = (code: IMConnectivityCheck['code']): string => {
  return i18nService.t(`imConnectivityCheckTitle_${code}`);
};

const formatTestTime = (timestamp: number): string => {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return String(timestamp);
  }
};

export const ConnectivityResultModal: React.FC<ConnectivityResultModalProps> = ({
  platform,
  result,
  failed,
  testing,
  onClose,
}) => (
  <Modal
    onClose={onClose}
    className="flex max-h-[min(24rem,calc(100vh-2rem))] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
  >
    <div className="flex shrink-0 items-center justify-between px-6 py-4">
      <DialogTitle>{`${i18nService.t(platform)} ${i18nService.t('imConnectivitySectionTitle')}`}</DialogTitle>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={i18nService.t('close')}
        onClick={onClose}
      >
        <X data-icon="inline-start" />
      </Button>
    </div>

    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
      {result ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <Badge
              variant={
                result.verdict === 'fail'
                  ? 'destructive'
                  : result.verdict === 'warn'
                    ? 'outline'
                    : 'default'
              }
            >
              {result.verdict === 'pass' ? (
                <CheckCircle data-icon="inline-start" />
              ) : result.verdict === 'warn' ? (
                <TriangleAlert data-icon="inline-start" />
              ) : (
                <XCircle data-icon="inline-start" />
              )}
              {i18nService.t(`imConnectivityVerdict_${result.verdict}`)}
            </Badge>
            <div className="text-xs text-muted-foreground">
              {`${i18nService.t('imConnectivityLastChecked')}: ${formatTestTime(result.testedAt)}`}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {result.checks.map((check, index) => (
              <Alert
                key={`${check.code}-${index}`}
                variant={check.level === 'fail' ? 'destructive' : 'default'}
              >
                {check.level === 'fail' ? (
                  <XCircle />
                ) : check.level === 'warn' ? (
                  <TriangleAlert />
                ) : (
                  <CheckCircle />
                )}
                <AlertTitle>{getCheckTitle(check.code)}</AlertTitle>
              </Alert>
            ))}
          </div>
        </div>
      ) : failed ? (
        <div className="flex flex-col gap-3">
          <Badge variant="destructive" className="w-fit">
            <XCircle data-icon="inline-start" />
            {i18nService.t('imConnectivityVerdict_fail')}
          </Badge>
          <Alert variant="destructive">
            <XCircle />
            <AlertTitle>{i18nService.t('imConnectivityTestFailed')}</AlertTitle>
          </Alert>
        </div>
      ) : testing ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          <span>{i18nService.t('imConnectivityTesting')}</span>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">
          {i18nService.t('imConnectivityNoResult')}
        </div>
      )}
    </div>
  </Modal>
);
