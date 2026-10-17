import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';

import { i18nService } from '../../services/i18n';

interface CodingSessionRecoveryDialogProps {
  /** Recovery context to review; guarded by the lane's recovery state. */
  context: string | null;
  onConfirm: (includeRecoveryContext: boolean) => void;
}

export const CodingSessionRecoveryDialog = ({
  context,
  onConfirm,
}: CodingSessionRecoveryDialogProps) => (
  <Dialog open>
    <DialogContent showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>{i18nService.t('codingAgentRecoveryTitle')}</DialogTitle>
        <DialogDescription>{i18nService.t('codingAgentRecoveryDescription')}</DialogDescription>
      </DialogHeader>
      <pre className="max-h-52 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words">
        {context}
      </pre>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onConfirm(false)}>
          {i18nService.t('codingAgentRecoveryStartFresh')}
        </Button>
        <Button type="button" onClick={() => onConfirm(true)}>
          {i18nService.t('codingAgentRecoverySendSummary')}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

interface CodingLaneChangesDialogProps {
  diff: string;
  onApply: () => void;
  onClose: () => void;
}

export const CodingLaneChangesDialog = ({
  diff,
  onApply,
  onClose,
}: CodingLaneChangesDialogProps) => (
  <Dialog open onOpenChange={open => !open && onClose()}>
    <DialogContent className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>{i18nService.t('codingAgentApplyChangesTitle')}</DialogTitle>
        <DialogDescription>{i18nService.t('codingAgentApplyChangesDescription')}</DialogDescription>
      </DialogHeader>
      <pre className="max-h-[50dvh] overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words">
        {diff || i18nService.t('codingAgentNoChanges')}
      </pre>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {i18nService.t('codingAgentHandoffCancel')}
        </Button>
        <Button type="button" disabled={!diff.trim()} onClick={onApply}>
          {i18nService.t('codingAgentApplyChangesConfirm')}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

interface CodingApplyConflictDialogProps {
  conflict: string;
  onClose: () => void;
}

export const CodingApplyConflictDialog = ({
  conflict,
  onClose,
}: CodingApplyConflictDialogProps) => (
  <Dialog open onOpenChange={open => !open && onClose()}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{i18nService.t('codingAgentConflictTitle')}</DialogTitle>
        <DialogDescription>{i18nService.t('codingAgentConflictDescription')}</DialogDescription>
      </DialogHeader>
      <div>
        <p className="mb-2 text-sm font-medium">{i18nService.t('codingAgentConflictDetails')}</p>
        <pre className="max-h-52 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words">
          {conflict}
        </pre>
      </div>
      <DialogFooter>
        <Button type="button" onClick={onClose}>
          {i18nService.t('codingAgentConflictClose')}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
