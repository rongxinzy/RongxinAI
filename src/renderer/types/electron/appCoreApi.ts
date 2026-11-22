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
import type {
  AppSystemInvokers,
  storeChannels,
  windowChannels,
} from '../../../shared/ipc/appSystemContract.channels';
import type { memoryContract } from '../../../shared/ipc/memoryContract';

interface WindowState {
  isMaximized: boolean;
  isFullscreen: boolean;
  isFocused: boolean;
}

export interface StoreApi extends Omit<AppSystemInvokers<typeof storeChannels>, 'set'> {
  set: (key: string, value: unknown) => Promise<void>;
}

export interface AppEventsApi {
  onOpenSettings: (callback: () => void) => () => void;
  onNewTask: (callback: () => void) => () => void;
}

export interface ContextMenuApi {
  execute: (action: ContextMenuAction) => void;
  onOpen: (callback: (event: ContextMenuOpenEvent) => void) => () => void;
}

export interface WindowApi extends AppSystemInvokers<typeof windowChannels> {
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  showSystemMenu: (position: { x: number; y: number }) => void;
  onStateChanged: (callback: (state: WindowState) => void) => () => void;
}

export type MemoryApi = IpcContractApi<typeof memoryContract>;
