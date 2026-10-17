/**
 * Props shared by the per-platform multi-instance settings panels.
 * Extracted from IMSettings.tsx (issue #1069).
 */
import type { Workspace } from '@shared/workspace';
import type { Platform } from '@shared/platform';

import type { IMConnectivityTestResult } from '../../../../types/im';

export interface MultiInstancePanelProps {
  workspaces: Workspace[];
  activeInstanceId: string | null;
  /** Select an instance, or null to deselect (shows the placeholder). */
  onSelectInstance: (instanceId: string | null) => void;
  /** Called after a new instance was created; selects and expands it. */
  onInstanceAdded: (instanceId: string) => void;
  onTestConnectivity: () => void;
  testingPlatform: string | null;
  connectivityResults: Partial<Record<Platform, IMConnectivityTestResult>>;
}
