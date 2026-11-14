import { CoworkSessionSource } from '../../shared/cowork/constants';
import type { CoworkStore } from '../coworkStore';
import { t } from '../i18n';

/** Automation records are projections of a task-owned native conversation. */
export function assertInteractiveCoworkSession(store: CoworkStore, sessionId: string): void {
  if (
    store.getSession(sessionId, 0, { includeArtifacts: false })?.source ===
    CoworkSessionSource.Scheduled
  ) {
    throw new Error(t('automationSessionReadOnly'));
  }
}
