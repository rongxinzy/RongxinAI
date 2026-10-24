import type { StrataCatalogEntry } from '../../../shared/strata/types';
import { StrataEngineKind, StrataFamilyId } from '../../../shared/strata/constants';

const STRATA_REPO = 'https://github.com/Niko1221/Strata';

/**
 * Supported Strata families for win-cuda dual-engine mode.
 * Hardware gates follow Strata README / DEEPSEEK41.md / QWEN36.md (documentation only).
 */
export const STRATA_MODEL_CATALOG: readonly StrataCatalogEntry[] = [
  {
    id: 'strata-qwen-flash-next',
    family: StrataFamilyId.QwenFlashNext,
    engine: StrataEngineKind.Qwen,
    displayName: 'Qwen3.8-Flash-Next (Strata)',
    modelLaunchId: 'gyro-s',
    hardware: {
      minSystemRamGb: 32,
      minVramGb: 12,
      minDiskGb: 80,
      docNoteKey: 'strataCatalogGateQwenFlashNext',
    },
    docUrl: `${STRATA_REPO}/blob/main/README.md`,
  },
  {
    id: 'strata-qwen36-35b-a3b',
    family: StrataFamilyId.Qwen36,
    engine: StrataEngineKind.Qwen,
    displayName: 'Qwen3.6-35B-A3B (Strata)',
    modelLaunchId: 'UD-Q4_K_XL',
    hardware: {
      minSystemRamGb: 32,
      minVramGb: 12,
      minDiskGb: 40,
      docNoteKey: 'strataCatalogGateQwen36',
    },
    docUrl: `${STRATA_REPO}/blob/main/docs/QWEN36.md`,
  },
  {
    id: 'strata-deepseek-v41-flash',
    family: StrataFamilyId.DeepSeek41,
    engine: StrataEngineKind.DeepSeek41,
    displayName: 'DeepSeek-V4.1-Flash (Strata)',
    modelLaunchId: 'IST-DAS-2.00bpw',
    hardware: {
      minSystemRamGb: 46,
      minVramGb: 12,
      minDiskGb: 239,
      docNoteKey: 'strataCatalogGateDeepSeek41',
    },
    docUrl: `${STRATA_REPO}/blob/main/docs/DEEPSEEK41.md`,
  },
] as const;

export function getStrataCatalogEntry(catalogId: string): StrataCatalogEntry | undefined {
  return STRATA_MODEL_CATALOG.find(entry => entry.id === catalogId);
}
