import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Download } from 'lucide-react';
import { useCallback } from 'react';

import { LlamaCppModelLaunchLogSessionStatus } from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import { useModelInspectorLaunchLogs } from '../hooks/useModelInspectorLaunchLogs';
import { LocalInferenceLogViewer } from './LocalInferenceLogViewer';
import { formatModelLaunchLogText } from '../utils/logFormatting';

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

  const logOutput = formatModelLaunchLogText(state.content) || (
    state.loading
      ? i18nService.t('localInferenceModelLaunchLogsWaiting')
      : i18nService.t('localInferenceModelLaunchLogWindowEmpty')
  );
  const statusLabel = state.session
    ? getStatusLabel(state.session.status)
    : i18nService.t('localInferenceModelLaunchNotStarted');

  return (
    <div className="mt-5 flex min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        {state.session?.status !== LlamaCppModelLaunchLogSessionStatus.Succeeded ? (
          <Badge variant="outline">{statusLabel}</Badge>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={i18nService.t('localInferenceModelLaunchLogsDownload')}
          disabled={!state.content}
          onClick={handleDownload}
        >
          <Download />
        </Button>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <LocalInferenceLogViewer
        text={logOutput}
        className="h-96 min-h-64 rounded-lg border-0"
      />
    </div>
  );
}

function getStatusLabel(status: LlamaCppModelLaunchLogSessionStatus): string {
  switch (status) {
    case LlamaCppModelLaunchLogSessionStatus.Starting:
      return i18nService.t('localInferenceModelLaunchStarting');
    case LlamaCppModelLaunchLogSessionStatus.Succeeded:
      return i18nService.t('localInferenceModelLaunchSucceeded');
    case LlamaCppModelLaunchLogSessionStatus.Failed:
      return i18nService.t('localInferenceModelLaunchFailed');
    default:
      return i18nService.t('localInferenceModelLaunchNotStarted');
  }
}
