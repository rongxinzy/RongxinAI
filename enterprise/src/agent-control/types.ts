import type {
  ControlEvent,
  ControlEventPage,
  HeartbeatResponse,
  JsonObject,
  SkillManifestResult,
} from '@aep/sdk-node';

export const ControlTaskType = {
  SkillReconcile: 'skill.reconcile',
} as const;

export const InboxState = {
  Received: 'received',
  Running: 'running',
  Succeeded: 'succeeded',
  Failed: 'failed',
  Terminal: 'terminal',
} as const;
export type InboxState = (typeof InboxState)[keyof typeof InboxState];

export const SkillSyncStatus = {
  Installed: 'installed',
  Updated: 'updated',
  Removed: 'removed',
  Unchanged: 'unchanged',
} as const;
export type SkillSyncStatus = (typeof SkillSyncStatus)[keyof typeof SkillSyncStatus];

export interface AgentControlClient {
  getSkillManifest(etag?: string): Promise<SkillManifestResult>;
  downloadSkillPackage(skillId: string, version: string): Promise<Uint8Array>;
  reportSkillSyncResult(result: JsonObject): Promise<void>;
  uploadEventBatch(events: JsonObject[]): Promise<JsonObject>;
  heartbeat(input: JsonObject): Promise<HeartbeatResponse>;
  listControlEvents(afterCursor?: string, limit?: number): Promise<ControlEventPage>;
  acknowledgeControlEvent(deliveryId: string, receivedAt: string): Promise<void>;
  reportControlEventResult(deliveryId: string, result: JsonObject): Promise<void>;
}

export interface InboxItem {
  readonly deliveryId: string;
  readonly event: ControlEvent;
  readonly state: InboxState;
}

export interface ManagedSkill {
  readonly skillId: string;
  readonly version: string;
  readonly sha256: string;
  readonly path: string;
}

export interface SkillSyncItem {
  readonly skillId: string;
  readonly version: string;
  readonly status: SkillSyncStatus;
}

export interface SkillReconcileResult {
  readonly revision: string;
  readonly items: readonly SkillSyncItem[];
}

export interface SkillReconciler {
  reconcile(): Promise<SkillReconcileResult>;
}
