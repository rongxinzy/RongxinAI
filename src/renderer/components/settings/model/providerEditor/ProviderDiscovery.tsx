import { Alert, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { Button } from '@shared/components/ui/button';
import { FieldDescription } from '@shared/components/ui/field';
import { CheckCircle2, CircleAlert, LoaderCircle, Plug } from 'lucide-react';
import { i18nService } from '../../../../services/i18n';
import { normalizeError } from '../../../../services/errorNormalization';
import { neutralRuntimeName } from '../../../../services/runtimeNameNeutralizer';
import { ProviderDiscoveryResolution } from './constants';
import type { ProviderEditor } from './useProviderEditor';

export function ProviderDiscovery({
  editor,
  canTest,
}: {
  editor: ProviderEditor;
  canTest: boolean;
}) {
  const result = editor.testResult;
  return (
    <div className="flex flex-col gap-4">
      {canTest && (
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void editor.testConnection()}
            disabled={editor.isSaving || editor.isTesting || !editor.draft.baseUrl.trim()}
          >
            {editor.isTesting ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plug className="size-4" aria-hidden="true" />
            )}
            {i18nService.t(editor.isTesting ? 'magpieTesting' : 'magpieTestAndDiscover')}
          </Button>
        </div>
      )}
      {result && (
        <Alert
          role={result.ok ? 'status' : 'alert'}
          variant={result.ok ? 'default' : 'destructive'}
        >
          {result.ok ? (
            <CheckCircle2 className="size-4" aria-hidden="true" />
          ) : (
            <CircleAlert className="size-4" aria-hidden="true" />
          )}
          <AlertTitle>
            {i18nService.t(result.ok ? 'magpieTestSuccess' : 'magpieTestFailed')}
          </AlertTitle>
          <AlertDescription>
            {result.ok ? (
              <span>
                {[
                  result.latencyMs === undefined ? null : `${result.latencyMs} ms`,
                  (result.discoveredModels?.length ?? result.modelCount) === undefined
                    ? null
                    : i18nService
                        .t('magpieTestModelsFound')
                        .replace(
                          '{count}',
                          String(result.discoveredModels?.length ?? result.modelCount),
                        ),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            ) : (
              <span>
                {result.requiresKey
                  ? i18nService.t('magpieTestRequiresKey')
                  : result.error
                    ? neutralRuntimeName(normalizeError(result.error))
                    : i18nService.t('magpieTestFailed')}
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}
      {editor.pendingModels && (
        <div className="flex flex-col gap-2">
          <FieldDescription>
            {i18nService
              .t('magpieModelConflictTitle')
              .replace('{count}', String(editor.pendingModels.length))}
          </FieldDescription>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={editor.isSaving}
              onClick={() => editor.resolveDiscovery(ProviderDiscoveryResolution.Replace)}
            >
              {i18nService.t('magpieModelConflictReplace')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={editor.isSaving}
              onClick={() => editor.resolveDiscovery(ProviderDiscoveryResolution.Append)}
            >
              {i18nService.t('magpieModelConflictAppend')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={editor.isSaving}
              onClick={() => editor.resolveDiscovery(ProviderDiscoveryResolution.Keep)}
            >
              {i18nService.t('magpieModelConflictKeep')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
