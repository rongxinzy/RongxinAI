/**
 * Public entry point of the cowork persistence layer.
 *
 * The implementation is split into focused modules under ./coworkStore
 * (issue #1069); this module re-exports the public surface so every existing
 * importer keeps working unchanged:
 *
 * - ./coworkStore/types          – shared types (sessions, messages, agents, config)
 * - ./coworkStore/helpers        – parsing/normalization helpers and row mappers
 * - ./coworkStore/base           – SQLite plumbing and repository handles
 * - ./coworkStore/workspaceStore – workspace CRUD
 * - ./coworkStore/messageStore   – message persistence and pagination
 * - ./coworkStore/sessionStore   – session CRUD and listing
 * - ./coworkStore/configStore    – cowork_config / kv access
 * - ./coworkStore/conversationSearchStore – conversation search
 * - ./coworkStore/agentStore     – agent CRUD
 */
import { CoworkAgentStore } from './coworkStore/agentStore';

export type {
  Agent,
  CreateAgentRequest,
  UpdateAgentRequest,
  CoworkConfig,
  CoworkConfigUpdate,
  CoworkConversationReplacementEntry,
  CoworkConversationSearchRecord,
  CoworkMessage,
  CoworkMessageMetadata,
  CoworkMessageType,
  CoworkSession,
  CoworkSessionStatus,
  CoworkSessionSummary,
} from './coworkStore/types';
export { CoworkExecutionMode } from '../shared/cowork/constants';

export class CoworkStore extends CoworkAgentStore {}
