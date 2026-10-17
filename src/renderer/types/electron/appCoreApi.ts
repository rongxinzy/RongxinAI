/**
 * Core app preload surface, split from `../electron.d.ts`.
 *
 * Key/value store, the renderer->main fetch proxy, app events, the context
 * menu bridge, window controls and the managed memory service.
 */
import type { ContextMenuAction, ContextMenuOpenEvent } from '../../../shared/contextMenu';

interface ApiResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: any;
  error?: string;
}

interface WindowState {
  isMaximized: boolean;
  isFullscreen: boolean;
  isFocused: boolean;
}

export interface StoreApi {
  get: (key: string) => Promise<any>;
  set: (key: string, value: any) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

export interface ApiProxyApi {
  fetch: (options: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    purpose?: import('../../../shared/ipc/apiRequest').ApiRequestPurpose;
  }) => Promise<ApiResponse>;
}

export interface AppEventsApi {
  onOpenSettings: (callback: () => void) => () => void;
  onNewTask: (callback: () => void) => () => void;
}

export interface ContextMenuApi {
  execute: (action: ContextMenuAction) => void;
  onOpen: (callback: (event: ContextMenuOpenEvent) => void) => () => void;
}

export interface WindowApi {
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  showSystemMenu: (position: { x: number; y: number }) => void;
  toggleDevTools: () => Promise<boolean>;
  openDevTools: () => Promise<boolean>;
  onStateChanged: (callback: (state: WindowState) => void) => () => void;
}

export interface MemoryApi {
  list: (
    input?: import('../../../shared/memory').ManagedMemoryListInput,
  ) => Promise<
    import('../../../shared/memory').MemoryIpcResult<
      import('../../../shared/memory').ManagedMemoryRecord[]
    >
  >;
  resolveSessionTitles: (
    input: import('../../../shared/memory').MemorySessionTitleResolveInput,
  ) => Promise<
    import('../../../shared/memory').MemoryIpcResult<
      import('../../../shared/memory').MemorySessionTitle[]
    >
  >;
  createManual: (
    input: import('../../../shared/memory').ManualMemoryCreateInput,
  ) => Promise<
    import('../../../shared/memory').MemoryIpcResult<
      import('../../../shared/memory').ManagedMemoryRecord
    >
  >;
  updateManual: (
    input: import('../../../shared/memory').ManualMemoryUpdateInput,
  ) => Promise<
    import('../../../shared/memory').MemoryIpcResult<
      import('../../../shared/memory').ManagedMemoryRecord
    >
  >;
  confirmCandidate: (
    id: string,
  ) => Promise<import('../../../shared/memory').MemoryIpcResult<number | null>>;
  archive: (id: string) => Promise<import('../../../shared/memory').MemoryIpcResult<void>>;
  restore: (id: string) => Promise<import('../../../shared/memory').MemoryIpcResult<void>>;
  forget: (
    id: string,
    hardDelete: boolean,
  ) => Promise<import('../../../shared/memory').MemoryIpcResult<boolean>>;
  drainOutbox: () => Promise<import('../../../shared/memory').MemoryIpcResult<number>>;
}
