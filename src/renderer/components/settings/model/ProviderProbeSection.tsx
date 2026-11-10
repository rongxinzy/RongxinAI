import { Alert, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { FieldDescription, FieldGroup } from '@shared/components/ui/field';
import { Button } from '@shared/components/ui/button';
import { AlertCircle, CheckCircle2, LoaderCircle, Sparkles } from 'lucide-react';
import type { MagpieTestProviderResult } from '../../../../shared/magpie/types';
import { i18nService } from '../../../services/i18n';

interface ProviderProbeSectionProps {
  isSaving: boolean;
  isTesting: boolean;
  baseUrl: string;
  isLocalProvider: boolean;
  hasKeyAvailable: boolean;
  testResult: MagpieTestProviderResult | null;
  pendingDiscoveredModels: string[] | null;
  handleTest: () => Promise<void>;
  handleResolveConflict: (action: 'replace' | 'append' | 'keep') => void;
}

export function ProviderProbeSection({
  isSaving,
  isTesting,
  baseUrl,
  isLocalProvider,
  hasKeyAvailable,
  testResult,
  pendingDiscoveredModels,
  handleTest,
  handleResolveConflict,
}: ProviderProbeSectionProps) {
  return (
    <>
      {/* 2. 探测连通并拉取模型按钮与状态反馈 */}
      <FieldGroup className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={isSaving || isTesting || !baseUrl.trim()}
              className="gap-1.5"
            >
              {isTesting ? (
                <LoaderCircle className="theme-composition-button-icon animate-spin" />
              ) : (
                <Sparkles className="theme-composition-button-icon" />
              )}
              <span>
                {isTesting
                  ? i18nService.t('magpieTesting')
                  : i18nService.t('magpieTestAndDiscover')}
              </span>
            </Button>
            {!isLocalProvider && !hasKeyAvailable && (
              <FieldDescription>{i18nService.t('magpieTestNeedKeyHint')}</FieldDescription>
            )}
          </div>
        </div>

        {testResult && (
          <Alert variant={testResult.ok ? 'default' : 'destructive'}>
            {testResult.ok ? (
              <>
                <CheckCircle2 className="theme-composition-button-icon" />
                <AlertTitle className="flex flex-wrap items-center gap-1.5">
                  <span>{i18nService.t('magpieTestSuccess')}</span>
                  {testResult.latencyMs !== undefined && <span>({testResult.latencyMs}ms)</span>}
                  {testResult.modelCount !== undefined && (
                    <span>
                      ·{' '}
                      {i18nService
                        .t('magpieTestModelsFound')
                        .replace('{count}', String(testResult.modelCount))}
                    </span>
                  )}
                </AlertTitle>
                {testResult.discoveredModels && testResult.discoveredModels.length > 0 && (
                  <AlertDescription>
                    {i18nService
                      .t('magpieTestAutoFilled')
                      .replace('{count}', String(testResult.discoveredModels.length))}
                  </AlertDescription>
                )}
              </>
            ) : (
              <>
                <AlertCircle className="theme-composition-button-icon" />
                <AlertTitle>{i18nService.t('magpieTestFailed')}</AlertTitle>
                <AlertDescription>
                  {testResult.requiresKey
                    ? i18nService.t('magpieTestRequiresKey')
                    : testResult.errorCode === 'html-endpoint'
                      ? i18nService.t('magpieTestHtmlEndpoint')
                      : testResult.errorCode === 'not-json'
                        ? i18nService.t('magpieTestNotJson')
                        : testResult.errorCode === 'too-large'
                          ? i18nService.t('magpieTestTooLarge')
                          : testResult.errorCode === 'api-error'
                            ? i18nService
                                .t('magpieTestApiError')
                                .replace('{message}', testResult.error ?? '')
                            : testResult.error}
                </AlertDescription>
              </>
            )}
          </Alert>
        )}
      </FieldGroup>

      {/* 3. 智能冲突解决操作条（仅当有模型被发现且用户已存在自定义配置时触发） */}
      {pendingDiscoveredModels && pendingDiscoveredModels.length > 0 && (
        <Alert className="gap-2">
          <AlertTitle>
            {i18nService
              .t('magpieModelConflictTitle')
              .replace('{count}', String(pendingDiscoveredModels.length))}
          </AlertTitle>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => handleResolveConflict('replace')}
            >
              {i18nService.t('magpieModelConflictReplace')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => handleResolveConflict('append')}
            >
              {i18nService.t('magpieModelConflictAppend')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => handleResolveConflict('keep')}
            >
              {i18nService.t('magpieModelConflictKeep')}
            </Button>
          </div>
        </Alert>
      )}
    </>
  );
}
