/**
 * Channel map for the todo IPC contract, importable by the sandboxed preload.
 * Kept in a separate zod-free module because the preload bundle must not
 * require zod; the type argument locks the map to the contract's channels.
 */
import type { IpcContractChannels } from './contract';
import type { todoContract } from './todoContract';
import { TodoIpc } from '../todo';

export const todoContractChannels: IpcContractChannels<typeof todoContract> = {
  list: TodoIpc.List,
  create: TodoIpc.Create,
  update: TodoIpc.Update,
  delete: TodoIpc.Delete,
  listLists: TodoIpc.ListLists,
  createList: TodoIpc.CreateList,
  updateList: TodoIpc.UpdateList,
  deleteList: TodoIpc.DeleteList,
  createStep: TodoIpc.CreateStep,
  updateStep: TodoIpc.UpdateStep,
  deleteStep: TodoIpc.DeleteStep,
} as const;
