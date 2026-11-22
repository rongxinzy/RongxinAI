import type { DesktopPetBuiltinId } from '../desktopPet/catalog';
import type { CompanionBubblePlacement } from './bubble';
import type { IpcContractApi } from '../ipc/contract';
import type { companionContract } from './contract';
import type { CompanionTaskProjection, CompanionWorkspace, CompanionTaskSnapshot } from './tasks';
import type {
  CompanionCapability,
  CompanionComposerMode,
  CompanionRequestState,
  CompanionUnavailableReason,
} from './constants';

/** Instance identity and personality survive a change of appearance. */
export interface CompanionProfile {
  petId: string;
  personaId: DesktopPetBuiltinId;
  characterId: DesktopPetBuiltinId;
  createdAt: number;
}

export interface CompanionAvailability {
  capability: CompanionCapability;
  modelId: string | null;
  imageInput: boolean;
  /** Catalog presence alone never establishes tool support. */
  toolUse: boolean;
  reason?: CompanionUnavailableReason;
}

export interface CompanionReceipt {
  petId: string;
  requestId: string;
  submissionId: number;
}

export interface CompanionMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  attachments?: Array<{ id: string; name: string }>;
}

export interface CompanionConversation {
  messages: CompanionMessage[];
  pending: CompanionReceipt | null;
  /** Latest admitted input, including after reopening. */
  lastReply?: CompanionReceipt & { state: CompanionRequestState };
}

export interface CompanionWindowContext {
  language: 'zh' | 'en';
  theme: 'light' | 'dark' | 'system';
  themeStyle: string;
  bubble?: CompanionBubblePlacement;
  mode?: CompanionComposerMode;
}

export interface CompanionWindowState {
  context: CompanionWindowContext;
  activePetId: string;
  profiles: CompanionProfile[];
  conversation: CompanionConversation;
  availability: CompanionAvailability;
  shortcutAvailable: boolean;
  workspaces: CompanionWorkspace[];
  tasks: CompanionTaskProjection[];
  taskRevision: number;
}

export type CompanionWindowApi = IpcContractApi<typeof companionContract> & {
  onFocus(listener: () => void): () => void;
  onContext(listener: (context: CompanionWindowContext) => void): () => void;
  onVisibility(listener: (visible: boolean) => void): () => void;
  onTasks(listener: (snapshot: CompanionTaskSnapshot) => void): () => void;
  onChanged(listener: () => void): () => void;
};

export interface CompanionNavigationApi {
  onWorkbench(listener: () => void): () => void;
}
