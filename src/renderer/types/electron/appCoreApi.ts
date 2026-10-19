/**
 * Core app preload surface, split from `../electron.d.ts`.
 *
 * Key/value store, app events, the context menu bridge, window controls and
 * the managed memory service. Memory method signatures derive from the zod IPC
 * contract (`src/shared/ipc/memoryContract.ts`) — the contract is the single
 * source of truth shared with main and preload.
 */
import type { ContextMenuAction, ContextMenuOpenEvent } from '../../../shared/contextMenu';
import type { IpcContractApi } from '../../../shared/ipc/contract';
import type { memoryContract } from '../../../shared/ipc/memoryContract';

interface WindowState {
  isMaximized: boolean;
  isFullscreen: boolean;
  isFocused: boolean;
}

export interface StoreApi {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  remove: (key: string) => Promise<void>;
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

export type MemoryApi = IpcContractApi<typeof memoryContract>;
