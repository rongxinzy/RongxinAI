/**
 * Channel map for the cowork IPC contract, importable by the sandboxed
 * preload. Kept in a separate zod-free module because the preload bundle must
 * not require zod; the type argument locks the map to the contract's channels.
 */
import type { IpcContractChannels } from './contract';
import type { coworkContract } from './coworkContract';
import {
  CoworkConfigIpc,
  CoworkPermissionIpc,
  CoworkQueueIpc,
  CoworkSessionIpc,
  CoworkStreamIpc,
} from './channels';
import { WorkspaceIpc } from '../workspace';

export const coworkContractChannels: IpcContractChannels<typeof coworkContract> = {
  getRunSnapshot: CoworkSessionIpc.RunSnapshot,
  getRuntimeSnapshots: CoworkStreamIpc.RuntimeSnapshots,
  requestStreamResync: CoworkStreamIpc.StreamResync,
  listWorkspaces: WorkspaceIpc.List,
  createWorkspace: WorkspaceIpc.Create,
  ensureWorkspace: WorkspaceIpc.Ensure,
  renameWorkspace: WorkspaceIpc.Rename,
  updateWorkspace: WorkspaceIpc.Update,
  deleteWorkspace: WorkspaceIpc.Delete,
  startSession: CoworkSessionIpc.Start,
  continueSession: CoworkSessionIpc.Continue,
  stopSession: CoworkSessionIpc.Stop,
  compactSession: CoworkSessionIpc.Compact,
  saveSession: CoworkSessionIpc.Save,
  deleteSession: CoworkSessionIpc.Delete,
  deleteSessions: CoworkSessionIpc.DeleteBatch,
  setSessionPinned: CoworkSessionIpc.Pin,
  renameSession: CoworkSessionIpc.Rename,
  updateSessionModel: CoworkSessionIpc.UpdateModel,
  getSession: CoworkSessionIpc.Get,
  remoteManaged: CoworkSessionIpc.RemoteManaged,
  listSessions: CoworkSessionIpc.List,
  getSessionMessages: CoworkSessionIpc.GetMessages,
  exportResultImage: CoworkSessionIpc.ExportResultImage,
  captureImageChunk: CoworkSessionIpc.CaptureImageChunk,
  saveResultImage: CoworkSessionIpc.SaveResultImage,
  exportSessionText: CoworkSessionIpc.ExportText,
  listPendingMessages: CoworkQueueIpc.List,
  enqueuePendingMessage: CoworkQueueIpc.Enqueue,
  updatePendingMessage: CoworkQueueIpc.Update,
  deletePendingMessage: CoworkQueueIpc.Delete,
  steerPendingMessage: CoworkQueueIpc.Steer,
  followUpPendingMessage: CoworkQueueIpc.FollowUp,
  respondToPermission: CoworkPermissionIpc.Respond,
  getConfig: CoworkConfigIpc.Get,
  setConfig: CoworkConfigIpc.Set,
} as const;
