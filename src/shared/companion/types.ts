import type { DesktopPetBuiltinId } from '../desktopPet/catalog';
import type { CompanionAttachment } from './attachments';
import type {
  CompanionTaskRequest,
  CompanionTaskResult,
  CompanionTaskProjection,
  CompanionWorkspace,
  CompanionTaskSnapshot,
} from './tasks';
import type {
  CompanionCapability,
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
  toolUse: false;
  reason?: CompanionUnavailableReason;
}

export interface CompanionReceipt {
  petId: string;
  requestId: string;
  submissionId: number;
}

export interface CompanionAnswer extends CompanionReceipt {
  state: CompanionRequestState;
  text: string;
}

export interface CompanionMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
}

export interface CompanionConversation {
  messages: CompanionMessage[];
  pending: CompanionReceipt | null;
}

export interface CompanionWindowContext {
  language: 'zh' | 'en';
  theme: 'light' | 'dark' | 'system';
  themeStyle: string;
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

export interface CompanionWindowApi {
  bootstrap(): Promise<CompanionWindowState>;
  select(petId: string): Promise<CompanionWindowState>;
  submit(request: { petId: string; requestId: string; text: string }): Promise<{
    availability: CompanionAvailability;
    receipt: CompanionReceipt | null;
  }>;
  answer(receipt: CompanionReceipt): Promise<CompanionAnswer>;
  stop(petId: string): Promise<void>;
  submitTask(request: CompanionTaskRequest): Promise<CompanionTaskResult>;
  tasks(): Promise<CompanionTaskSnapshot>;
  stopTask(sessionId: string): Promise<void>;
  chooseWorkspace(): Promise<CompanionWorkspace | null>;
  chooseFiles(petId: string): Promise<CompanionAttachment[]>;
  hide(): Promise<void>;
  openWorkbench(sessionId?: string): Promise<void>;
  onContext(listener: (context: CompanionWindowContext) => void): () => void;
  onVisibility(listener: (visible: boolean) => void): () => void;
  onTasks(listener: (snapshot: CompanionTaskSnapshot) => void): () => void;
  onChanged(listener: () => void): () => void;
  onWorkbench(listener: () => void): () => void;
}
