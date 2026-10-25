import {
  MemoryDeliveryStatus,
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySourceKind,
  parseMemoryTimestamp,
  type ManagedMemoryRecord,
} from '../../../../shared/memory';
import { i18nService } from '../../../services/i18n';

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

export function canEdit(record: ManagedMemoryRecord): boolean {
  return (
    record.scope !== MemoryScope.Session &&
    (record.status === MemoryLifecycleStatus.Active ||
      record.status === MemoryLifecycleStatus.NeedsReview) &&
    record.deliveryStatus !== MemoryDeliveryStatus.Pending
  );
}

export function displayTitle(
  record: ManagedMemoryRecord,
  sessionTitles: ReadonlyMap<string, string>,
  workspaceName: string,
): string {
  if (record.scope !== MemoryScope.Session) return record.title;
  const sessionTitle =
    sessionTitles.get(record.sessionId)?.trim() ||
    record.title.trim() ||
    i18nService.t('managedMemorySessionSummaryTitle');
  return workspaceName ? `${workspaceName} - ${sessionTitle}` : sessionTitle;
}

export function scopeLabel(scope: ManagedMemoryRecord['scope']): string {
  if (scope === MemoryScope.Personal) return i18nService.t('managedMemoryScopePersonal');
  if (scope === MemoryScope.Session) return i18nService.t('managedMemoryScopeSession');
  return i18nService.t('managedMemoryScopeProject');
}

export function kindLabel(kind: ManagedMemoryRecord['kind']): string {
  if (kind === MemoryKind.Preference) return i18nService.t('managedMemoryKindPreference');
  if (kind === MemoryKind.SessionSummary) {
    return i18nService.t('managedMemoryKindSessionSummary');
  }
  return i18nService.t('managedMemoryKindDecision');
}

export function statusLabel(status: ManagedMemoryRecord['status']): string {
  const keys: Record<ManagedMemoryRecord['status'], string> = {
    [MemoryLifecycleStatus.Active]: 'managedMemoryStatusActive',
    [MemoryLifecycleStatus.NeedsReview]: 'managedMemoryStatusNeedsReview',
    [MemoryLifecycleStatus.Superseded]: 'managedMemoryStatusSuperseded',
    [MemoryLifecycleStatus.Expired]: 'managedMemoryStatusExpired',
    [MemoryLifecycleStatus.Archived]: 'managedMemoryStatusArchived',
    [MemoryLifecycleStatus.Deleted]: 'managedMemoryStatusDeleted',
  };
  return i18nService.t(keys[status]);
}

export function statusVariant(status: ManagedMemoryRecord['status']): 'secondary' | 'outline' {
  return status === MemoryLifecycleStatus.NeedsReview ? 'secondary' : 'outline';
}

export function deliveryLabel(status: NonNullable<ManagedMemoryRecord['deliveryStatus']>): string {
  if (status === MemoryDeliveryStatus.Pending) {
    return i18nService.t('managedMemoryPropagationPending');
  }
  if (status === MemoryDeliveryStatus.Failed) {
    return i18nService.t('managedMemoryPropagationFailed');
  }
  return i18nService.t('managedMemoryPropagationCompleted');
}

export function sourceLabel(
  record: ManagedMemoryRecord,
  sessionTitles: ReadonlyMap<string, string>,
): string {
  if (record.sourceKind === MemorySourceKind.LegacyFileImport) {
    return i18nService.t('managedMemorySourceLegacyFile');
  }
  if (record.sourceKind === MemorySourceKind.LegacySqliteImport) {
    return i18nService.t('managedMemorySourceLegacySqlite');
  }
  if (record.sourceKind === MemorySourceKind.Explicit) {
    return i18nService.t('managedMemorySourceManual');
  }
  if (record.promotedFromLinkId) {
    if (record.promotionSourceSessionId) {
      const sessionTitle = sessionTitles.get(record.promotionSourceSessionId)?.trim();
      return i18nService
        .t('managedMemoryPromotedFromSession')
        .replace('{name}', sessionTitle || i18nService.t('managedMemorySourceUnavailable'));
    }
    return i18nService.t('managedMemoryPromotedFromWorkspace');
  }
  const sourceSessionId = record.sessionId;
  const sessionTitle = sessionTitles.get(sourceSessionId)?.trim();
  if (sessionTitle) return sessionTitle;
  return i18nService.t('managedMemorySourceUnavailable');
}

export function formatDate(value: string): string {
  const timestamp = parseMemoryTimestamp(value);
  if (Number.isNaN(timestamp)) return value;
  const locale = i18nService.getLanguage() === 'zh' ? 'zh-CN' : 'en-US';
  let formatter = dateTimeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    dateTimeFormatters.set(locale, formatter);
  }
  return formatter.format(new Date(timestamp));
}
