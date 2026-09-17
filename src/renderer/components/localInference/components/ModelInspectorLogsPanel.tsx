import { Button } from '@shared/components/ui/button';
import { Download } from 'lucide-react';
import { useCallback } from 'react';

import { i18nService } from '../../../services/i18n';
import { useModelInspectorLaunchLogs } from '../hooks/useModelInspectorLaunchLogs';
import { LocalInferenceLogViewer } from './LocalInferenceLogViewer';

export function ModelInspectorLogsPanel({ modelName }: { modelName: string }) {
  const state = useModelInspectorLaunchLogs(modelName, true);
  const handleDownload = useCallback(() => {
    if (!state.content) return;
    const blob = new Blob([state.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `model-launch-log-${modelName.replace(/[^a-z0-9._-]+/gi, '-')}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [modelName, state.content]);

  const logOutput = state.content || (
    state.loading
      ? i18nService.t('localInferenceModelLaunchLogsWaiting')
      : i18nService.t('localInferenceModelLaunchLogWindowEmpty')
  );
  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col gap-3">
      {state.error ? <p className="shrink-0 text-sm text-destructive">{state.error}</p> : null}
      <LocalInferenceLogViewer
        text={logOutput}
        className="min-h-0 flex-1"
        toolbar={
          <div className="flex min-w-0 flex-1 items-center justify-end px-3">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={i18nService.t('localInferenceModelLaunchLogsDownload')}
              disabled={!state.content}
              onClick={handleDownload}
            >
              <Download data-icon="inline-start" />
            </Button>
          </div>
        }
      />
    </div>
  );
}
