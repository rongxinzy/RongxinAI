import type { CoworkSessionInterruption } from '../../../../shared/cowork/interruption';
import type { CoworkMessageExpertIdentity } from '../../../../shared/cowork/sessionExperts';
import type { CoworkToolActivityProgress } from '../../../../shared/cowork/toolActivity';
import type { Artifact } from '../../../types/artifact';
import type { CoworkMessage, CoworkPermissionRequest } from '../../../types/cowork';

export type ToolPhase =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'running'
  | 'output-available'
  | 'output-error'
  | 'output-denied';

export type ToolCategory =
  | 'shell'
  | 'file-read'
  | 'file-write'
  | 'search'
  | 'web'
  | 'mcp'
  | 'python'
  | 'skill'
  | 'other';

export interface ReasoningTurnPart {
  kind: 'reasoning';
  id: string;
  message: CoworkMessage;
  isStreaming: boolean;
  isComplete: boolean;
  durationSeconds?: number;
}

export interface TextTurnPart {
  kind: 'text';
  id: string;
  message: CoworkMessage;
  isStreaming: boolean;
  isFinalAnswer: boolean;
}

export interface ToolTurnPart {
  kind: 'tool';
  id: string;
  toolCallId: string;
  toolName: string;
  category: ToolCategory;
  readOnly: boolean;
  input?: Record<string, unknown>;
  phase: ToolPhase;
  progress?: CoworkToolActivityProgress;
  output?: string;
  contentTruncated?: boolean;
  isError: boolean;
  startedAt?: number;
  updatedAt?: number;
  pendingPermission?: CoworkPermissionRequest | null;
}

export type ActivityGroupItemPart = ReasoningTurnPart | ToolTurnPart;

export interface ToolGroupTurnPart {
  kind: 'tool_group';
  id: string;
  parts: ActivityGroupItemPart[];
  hasError: boolean;
  hasApproval: boolean;
}

interface QuestionTurnPart {
  kind: 'question';
  id: string;
  permission: CoworkPermissionRequest;
}

export interface NoticeTurnPart {
  kind: 'notice';
  id: string;
  message: CoworkMessage;
  isError: boolean;
  interruption?: CoworkSessionInterruption;
}

export type TurnPart =
  | ReasoningTurnPart
  | TextTurnPart
  | ToolTurnPart
  | ToolGroupTurnPart
  | QuestionTurnPart
  | NoticeTurnPart;

export interface ConversationTurn {
  id: string;
  index: number;
  userMessage: CoworkMessage | null;
  parts: TurnPart[];
  deliverables: Artifact[];
  copyText: string | null;
  experts: CoworkMessageExpertIdentity[];
  isStreaming: boolean;
  isComplete: boolean;
  hasApproval: boolean;
  hasError: boolean;
  modelLabel: string | null;
  timestamp: number | null;
}
