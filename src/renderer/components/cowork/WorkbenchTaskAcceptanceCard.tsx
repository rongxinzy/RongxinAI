import { Queue, QueueItemContent } from '@shared/components/ai-elements/queue';
import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { ClipboardCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  WorkbenchTaskStatus,
  WorkbenchVerificationOutcome,
  type WorkbenchTaskDetail,
} from '../../../shared/workbenchTask';
import { i18nService } from '../../services/i18n';
import { showAppErrorToast, showAppSuccessToast } from '../../services/toastNotification';
import { getProjectedRun } from './workbenchTaskAudit/utils';

interface WorkbenchTaskAcceptanceCardProps {
  sessionId: string;
}

/**
 * Inline acceptance card rendered at the end of the conversation flow when a
 * work task finished with `AcceptanceRequired` (no deterministic verifier was
 * available for the result). Mirrors the AskUserQuestionCard placement: the
 * user sees the final answer, then decides to accept or re-run in place.
 */
export function WorkbenchTaskAcceptanceCard({ sessionId }: WorkbenchTaskAcceptanceCardProps) {
  const [detail, setDetail] = useState<WorkbenchTaskDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await window.electron.workbenchTask.getCurrent(sessionId);
    if (result.success) setDetail(result.detail ?? null);
  }, [sessionId]);

  useEffect(() => {
    setDetail(null);
    void load();
    return window.electron.workbenchTask.onChanged(event => {
      if (event.sessionId === sessionId) void load();
    });
  }, [load, sessionId]);

  const runAction = useCallback(
    async (
      action: () => Promise<{ success: boolean; error?: string }>,
      confirmAcceptance = false,
    ) => {
      setBusy(true);
      try {
        const result = await action();
        if (!result.success) throw new Error(result.error);
        if (confirmAcceptance) showAppSuccessToast(i18nService.t('workbenchTaskAcceptedToast'));
      } catch (error) {
        console.error('[WorkbenchTask] Acceptance action failed:', error);
        showAppErrorToast(i18nService.t('workbenchTaskActionFailed'));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  if (!detail) return null;

  const task = detail.task;
  const activeRun = getProjectedRun(detail);
  const requiresAcceptance =
    task.status === WorkbenchTaskStatus.NeedsReview &&
    activeRun?.verificationResult?.outcome === WorkbenchVerificationOutcome.AcceptanceRequired;
  if (!requiresAcceptance) return null;

  const verificationSummary =
    activeRun?.verificationResult?.summary ??
    i18nService.t('workbenchTaskAcceptanceCardNoSummary');

  // 2026/09/20 lixiang  与对话列同宽，避免验收卡显得过窄（issue #805）
  // 2026/09/20 lixiang  与上方文件卡留出间隙（TurnBlock 段内 gap-1 专为文件↔复制收紧）
  return (
    <Queue className="mt-3 w-full rounded-lg bg-card shadow-none">
      <div className="flex items-center gap-2 px-1 text-sm font-medium text-foreground">
        <ClipboardCheck className="size-4 text-muted-foreground" />
        <span>{i18nService.t('workbenchTaskAcceptanceCardTitle')}</span>
        <Badge variant="outline" className="ml-auto">
          {i18nService.t('workbenchTaskNeedsReviewLabel')}
        </Badge>
      </div>

      <QueueItemContent className="theme-queue-acceptance-content line-clamp-none">
        {i18nService.t('workbenchTaskAcceptanceCardDescription')}
      </QueueItemContent>

      <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        {verificationSummary}
      </div>

      {/* 2026/09/20 lixiang  次要动作用 ghost（同授权卡），避免 outline 白底+边框与卡片糊成「贴死」主按钮 */}
      <div className="flex items-center justify-end gap-3 border-t border-border pt-3">
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => void runAction(() => window.electron.workbenchTask.retry(task.id))}
        >
          {i18nService.t('workbenchTaskRetry')}
        </Button>
        <Button
          type="button"
          disabled={busy}
          onClick={() => void runAction(() => window.electron.workbenchTask.accept(task.id), true)}
        >
          {i18nService.t('workbenchTaskAccept')}
        </Button>
      </div>
    </Queue>
  );
}
