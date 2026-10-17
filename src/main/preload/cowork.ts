import { ipcRenderer } from 'electron';

import type {
  CoworkExecutionMode,
  CoworkPermissionMode,
  CoworkSessionMode,
  CoworkSessionSource,
} from '../../shared/cowork/constants';
import type { CoworkRunSnapshot, CoworkContentPatch } from '../../shared/cowork/runState';
import {
  CoworkConfigIpc,
  CoworkPermissionIpc,
  CoworkQueueIpc,
  CoworkSessionIpc,
  CoworkStreamIpc,
} from '../../shared/ipc/channels';
import { TodoIpc } from '../../shared/todo';
import {
  WorkbenchTaskIpc,
  type WorkbenchApprovalResponseInput,
  type WorkbenchTaskChangedEvent,
} from '../../shared/workbenchTask';
import { WorkspaceIpc } from '../../shared/workspace';
import { onPush } from './pushChannel';

// Cowork sessions, workbench tasks, and todos.
export const coworkApi = {
  cowork: {
    getRunSnapshot: (sessionId: string, replayContent = false) =>
      ipcRenderer.invoke(CoworkSessionIpc.RunSnapshot, sessionId, replayContent),
    onStreamRunState: (callback: (snapshot: CoworkRunSnapshot) => void) =>
      onPush(CoworkStreamIpc.RunState, callback),
    onStreamContentPatch: (callback: (patch: CoworkContentPatch) => void) =>
      onPush(CoworkStreamIpc.ContentPatch, callback),
    listWorkspaces: () => ipcRenderer.invoke(WorkspaceIpc.List),
    createWorkspace: (options: { path: string; name: string }) =>
      ipcRenderer.invoke(WorkspaceIpc.Create, options),
    ensureWorkspace: (options: { path: string; name?: string }) =>
      ipcRenderer.invoke(WorkspaceIpc.Ensure, options),
    renameWorkspace: (id: string, name: string) =>
      ipcRenderer.invoke(WorkspaceIpc.Rename, id, name),
    updateWorkspace: (options: {
      id: string;
      name?: string;
      primaryPath?: string;
      folders?: string[];
    }) => ipcRenderer.invoke(WorkspaceIpc.Update, options),
    deleteWorkspace: (id: string) => ipcRenderer.invoke(WorkspaceIpc.Delete, id),
    startSession: (options: {
      prompt: string;
      cwd?: string;
      systemPrompt?: string;
      title?: string;
      mode?: CoworkSessionMode;
      goalMode?: boolean;
      activeSkillIds?: string[];
      workspaceId?: string;
      agentId?: string;
      expertIds?: string[];
      modelOverride?: string;
      permissionMode?: CoworkPermissionMode;
      imageAttachments?: Array<{
        name: string;
        mimeType: string;
        base64Data?: string;
        path?: string;
      }>;
      fileAttachments?: Array<{ name: string; path: string; extension: string; isImage?: boolean }>;
    }) => ipcRenderer.invoke(CoworkSessionIpc.Start, options),

    continueSession: (options: {
      sessionId: string;
      prompt: string;
      systemPrompt?: string;
      activeSkillIds?: string[];
      goalMode?: boolean;
      expertIds?: string[];
      permissionMode?: CoworkPermissionMode;
      imageAttachments?: Array<{
        name: string;
        mimeType: string;
        base64Data?: string;
        path?: string;
      }>;
      fileAttachments?: Array<{ name: string; path: string; extension: string; isImage?: boolean }>;
    }) => ipcRenderer.invoke(CoworkSessionIpc.Continue, options),

    listPendingMessages: (sessionId: string) => ipcRenderer.invoke(CoworkQueueIpc.List, sessionId),
    enqueuePendingMessage: (options: {
      sessionId: string;
      text: string;
      imageAttachments?: Array<{
        name: string;
        mimeType: string;
        base64Data?: string;
        path?: string;
      }>;
      fileAttachments?: Array<{ name: string; path: string; extension: string; isImage?: boolean }>;
      skillIds?: string[];
    }) => ipcRenderer.invoke(CoworkQueueIpc.Enqueue, options),
    updatePendingMessage: (options: { sessionId: string; itemId: string; text: string }) =>
      ipcRenderer.invoke(CoworkQueueIpc.Update, options),
    deletePendingMessage: (options: { sessionId: string; itemId: string }) =>
      ipcRenderer.invoke(CoworkQueueIpc.Delete, options),
    steerPendingMessage: (options: { sessionId: string; itemId: string }) =>
      ipcRenderer.invoke(CoworkQueueIpc.Steer, options),
    followUpPendingMessage: (options: { sessionId: string; itemId: string }) =>
      ipcRenderer.invoke(CoworkQueueIpc.FollowUp, options),

    stopSession: (sessionId: string) => ipcRenderer.invoke(CoworkSessionIpc.Stop, sessionId),
    compactSession: (sessionId: string) => ipcRenderer.invoke(CoworkSessionIpc.Compact, sessionId),
    saveSession: (session: Record<string, unknown>) =>
      ipcRenderer.invoke(CoworkSessionIpc.Save, session),
    deleteSession: (sessionId: string) => ipcRenderer.invoke(CoworkSessionIpc.Delete, sessionId),
    deleteSessions: (sessionIds: string[]) =>
      ipcRenderer.invoke(CoworkSessionIpc.DeleteBatch, sessionIds),
    setSessionPinned: (options: { sessionId: string; pinned: boolean }) =>
      ipcRenderer.invoke(CoworkSessionIpc.Pin, options),
    renameSession: (options: { sessionId: string; title: string }) =>
      ipcRenderer.invoke(CoworkSessionIpc.Rename, options),
    updateSessionModel: (options: { sessionId: string; modelOverride: string }) =>
      ipcRenderer.invoke(CoworkSessionIpc.UpdateModel, options),
    getSession: (sessionId: string, options?: { messageLimit?: number | null }) =>
      ipcRenderer.invoke(CoworkSessionIpc.Get, sessionId, options),
    getRuntimeSnapshots: (sessionId?: string) =>
      ipcRenderer.invoke(CoworkStreamIpc.RuntimeSnapshots, sessionId),
    remoteManaged: (sessionId: string) =>
      ipcRenderer.invoke(CoworkSessionIpc.RemoteManaged, sessionId),
    listSessions: (options?: {
      limit?: number;
      offset?: number;
      agentId?: string;
      workspaceId?: string;
      mode?: CoworkSessionMode;
      sources?: CoworkSessionSource[];
    }) => ipcRenderer.invoke(CoworkSessionIpc.List, options),
    getSessionMessages: (options: { sessionId: string; limit?: number; offset?: number }) =>
      ipcRenderer.invoke(CoworkSessionIpc.GetMessages, options),
    exportResultImage: (options: {
      rect: { x: number; y: number; width: number; height: number };
      defaultFileName?: string;
    }) => ipcRenderer.invoke(CoworkSessionIpc.ExportResultImage, options),
    captureImageChunk: (options: {
      rect: { x: number; y: number; width: number; height: number };
    }) => ipcRenderer.invoke(CoworkSessionIpc.CaptureImageChunk, options),
    saveResultImage: (options: { pngBase64: string; defaultFileName?: string }) =>
      ipcRenderer.invoke(CoworkSessionIpc.SaveResultImage, options),
    exportSessionText: (options: {
      content: string;
      defaultFileName?: string;
      fileExtension?: string;
    }) => ipcRenderer.invoke(CoworkSessionIpc.ExportText, options),

    respondToPermission: (options: { requestId: string; result: unknown }) =>
      ipcRenderer.invoke(CoworkPermissionIpc.Respond, options),

    getConfig: () => ipcRenderer.invoke(CoworkConfigIpc.Get),
    setConfig: (config: {
      workingDirectory?: string;
      executionMode?: CoworkExecutionMode;
      permissionMode?: CoworkPermissionMode;
      permissionModeBySession?: Record<string, CoworkPermissionMode>;
      embeddingEnabled?: boolean;
      embeddingProvider?: string;
      embeddingModel?: string;
      embeddingLocalModelPath?: string;
      embeddingVectorWeight?: number;
      embeddingRemoteBaseUrl?: string;
      embeddingRemoteApiKey?: string;
      codemodeEnabled?: boolean;
      mcpNativeBridge?: boolean;
    }) => ipcRenderer.invoke(CoworkConfigIpc.Set, config),

    onStreamUiEvent: (
      callback: (event: import('../../shared/cowork/piUiEvent').PiUiEvent) => void,
    ) => onPush(CoworkStreamIpc.UiEvent, callback),
    onSessionsChanged: (
      callback: (data: {
        sessionId?: string;
        deletedSessionIds?: string[];
        agentId?: string;
      }) => void,
    ) => onPush(CoworkStreamIpc.SessionsChanged, callback),
  },

  workbenchTask: {
    getCurrent: (sessionId: string) => ipcRenderer.invoke(WorkbenchTaskIpc.GetCurrent, sessionId),
    getDetail: (taskId: string) => ipcRenderer.invoke(WorkbenchTaskIpc.GetDetail, taskId),
    listForSession: (sessionId: string) =>
      ipcRenderer.invoke(WorkbenchTaskIpc.ListForSession, sessionId),
    exportAudit: (taskId: string) => ipcRenderer.invoke(WorkbenchTaskIpc.ExportAudit, taskId),
    resume: (input: import('../../shared/workbenchTask').WorkbenchTaskResumeInput) =>
      ipcRenderer.invoke(WorkbenchTaskIpc.Resume, input),
    retry: (taskId: string) => ipcRenderer.invoke(WorkbenchTaskIpc.Retry, taskId),
    accept: (taskId: string) => ipcRenderer.invoke(WorkbenchTaskIpc.Accept, taskId),
    respondToApproval: (input: WorkbenchApprovalResponseInput) =>
      ipcRenderer.invoke(WorkbenchTaskIpc.RespondToApproval, input),
    onChanged: (callback: (event: WorkbenchTaskChangedEvent) => void) =>
      onPush(WorkbenchTaskIpc.Changed, callback),
  },

  todo: {
    list: (input: import('../../shared/todo').TodoListInput) =>
      ipcRenderer.invoke(TodoIpc.List, input),
    create: (input: import('../../shared/todo').TodoCreateInput) =>
      ipcRenderer.invoke(TodoIpc.Create, input),
    update: (input: import('../../shared/todo').TodoUpdateInput & { todoId: string }) =>
      ipcRenderer.invoke(TodoIpc.Update, input),
    delete: (todoId: string) => ipcRenderer.invoke(TodoIpc.Delete, todoId),
    listLists: () => ipcRenderer.invoke(TodoIpc.ListLists),
    createList: (input: import('../../shared/todo').TodoListCreateInput) =>
      ipcRenderer.invoke(TodoIpc.CreateList, input),
    updateList: (input: import('../../shared/todo').TodoListUpdateInput & { listId: string }) =>
      ipcRenderer.invoke(TodoIpc.UpdateList, input),
    deleteList: (listId: string) => ipcRenderer.invoke(TodoIpc.DeleteList, listId),
    createStep: (input: import('../../shared/todo').TodoStepCreateInput) =>
      ipcRenderer.invoke(TodoIpc.CreateStep, input),
    updateStep: (input: import('../../shared/todo').TodoStepUpdateInput) =>
      ipcRenderer.invoke(TodoIpc.UpdateStep, input),
    deleteStep: (stepId: string) => ipcRenderer.invoke(TodoIpc.DeleteStep, stepId),
    onChanged: (callback: (event: import('../../shared/todo').TodoChangedEvent) => void) =>
      onPush(TodoIpc.Changed, callback),
  },
};
