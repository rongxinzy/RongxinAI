import type { StrataEngineKind, StrataFamilyId, StrataInstallPhase } from './constants';

export const StrataServiceStatus = {
  Unknown: 'unknown',
  NotBundled: 'not-bundled',
  Installed: 'installed',
  Starting: 'starting',
  Running: 'running',
  Stopping: 'stopping',
  Stopped: 'stopped',
  Error: 'error',
} as const;

export type StrataServiceStatus = (typeof StrataServiceStatus)[keyof typeof StrataServiceStatus];

interface StrataHardwareGate {
  /** Minimum system RAM (GB). Values from Strata official docs only. */
  minSystemRamGb: number;
  /** Minimum GPU VRAM (GB). */
  minVramGb: number;
  /** Minimum free disk for model artifacts (GB). */
  minDiskGb: number;
  /** Human-readable note citing Strata documentation (not measured throughput). */
  docNoteKey: string;
}

export interface StrataCatalogEntry {
  id: string;
  family: StrataFamilyId;
  engine: StrataEngineKind;
  displayName: string;
  modelLaunchId: string;
  hardware: StrataHardwareGate;
  /** Strata docs URL section for this family. */
  docUrl: string;
  marketplaceVariants?: StrataMarketplaceVariant[];
}

export interface StrataMarketplaceVariant {
  label: string;
  launchId: string;
  files: {
    repoId: string;
    revision: string;
    path: string;
    bytes: number;
    sha256: string;
    shared?: true;
  }[];
}

export interface StrataVariantRef {
  catalogId: string;
  launchId: string;
}

export interface StrataInstallState {
  installed: StrataVariantRef[];
  job?: StrataVariantRef & {
    phase: StrataInstallPhase;
    completed: number;
    total: number;
    error?: string;
  };
}

export interface StrataServiceConfig {
  port?: string;
}

export interface StrataStatusSnapshot {
  status: StrataServiceStatus;
  checkedAt: string;
  port?: number;
  baseUrl?: string;
  activeModelId?: string;
  activeLaunchId?: string;
  managedByApp?: boolean;
  error?: string;
  bundled?: boolean;
}

export interface StrataStartInput {
  catalogId: string;
  launchId?: string;
}
