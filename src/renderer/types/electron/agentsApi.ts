/**
 * Agent preload surface, split from `../electron.d.ts`.
 *
 * Covers agent profiles/preset experts plus the per-session workbench task
 * and todo surfaces. `importExpertPackage` / `getPresetExperts` derive from
 * the zod IPC contract (`src/shared/ipc/providersContract.ts`); the
 * list/get/create/update/delete methods unwrap the success envelope in the
 * preload and keep their unwrapped signatures.
 * The workbench/todo invoke signatures derive from the zod IPC contracts
 * (`src/shared/ipc/workbenchTaskContract.ts`, `src/shared/ipc/todoContract.ts`);
 * their result rows are main-owned projections, so the shared result
 * interfaces re-pin what the contracts declare as envelope-only fields.
 */
import type { IpcContractApi } from '../../../shared/ipc/contract';
import type { workbenchTaskContract } from '../../../shared/ipc/workbenchTaskContract';
import type { todoContract } from '../../../shared/ipc/todoContract';
import type {
  WorkbenchApprovalResponseInput,
  WorkbenchTaskActionResult,
  WorkbenchTaskChangedEvent,
  WorkbenchTaskExportResult,
  WorkbenchTaskListResult,
  WorkbenchTaskResumeInput,
} from '../../../shared/workbenchTask';
import type {
  TodoActionResult,
  TodoChangedEvent,
  TodoCreateInput,
  TodoListActionResult,
  TodoListInput,
  TodoListResult,
  TodoListUpdateInput,
  TodoListsResult,
  TodoStepActionResult,
  TodoStepCreateInput,
  TodoStepUpdateInput,
  TodoUpdateInput,
} from '../../../shared/todo';
import type { Agent } from '../agent';
import type { providersContract } from '../../../shared/ipc/providersContract';

type ProvidersContractApi = IpcContractApi<typeof providersContract>;

type WorkbenchTaskContractApi = IpcContractApi<typeof workbenchTaskContract>;

/**
 * Contract-derived surface with the row types re-pinned to the shared result
 * interfaces. Re-pinned methods are omitted from the contract view before the
 * intersection (an intersection of two signatures never replaces a member);
 * the arg signatures of the remaining methods stay locked to the contract.
 */
export type WorkbenchTaskApi = Omit<
  WorkbenchTaskContractApi,
  | 'onChanged'
  | 'getCurrent'
  | 'getDetail'
  | 'listForSession'
  | 'exportAudit'
  | 'resume'
  | 'retry'
  | 'accept'
  | 'respondToApproval'
> & {
  getCurrent: (sessionId: string) => Promise<WorkbenchTaskActionResult>;
  getDetail: (taskId: string) => Promise<WorkbenchTaskActionResult>;
  listForSession: (sessionId: string) => Promise<WorkbenchTaskListResult>;
  exportAudit: (taskId: string) => Promise<WorkbenchTaskExportResult>;
  resume: (input: WorkbenchTaskResumeInput) => Promise<WorkbenchTaskActionResult>;
  retry: (taskId: string) => Promise<WorkbenchTaskActionResult>;
  accept: (taskId: string) => Promise<WorkbenchTaskActionResult>;
  respondToApproval: (input: WorkbenchApprovalResponseInput) => Promise<WorkbenchTaskActionResult>;
  onChanged: (callback: (event: WorkbenchTaskChangedEvent) => void) => () => void;
};

type TodoContractApi = IpcContractApi<typeof todoContract>;

export type TodoApi = Omit<
  TodoContractApi,
  | 'onChanged'
  | 'list'
  | 'create'
  | 'update'
  | 'listLists'
  | 'createList'
  | 'updateList'
  | 'createStep'
  | 'updateStep'
> & {
  list: (input: TodoListInput) => Promise<TodoListResult>;
  create: (input: TodoCreateInput) => Promise<TodoActionResult>;
  update: (input: TodoUpdateInput & { todoId: string }) => Promise<TodoActionResult>;
  delete: (todoId: string) => Promise<{ success: boolean; error?: string }>;
  listLists: () => Promise<TodoListsResult>;
  createList: (
    input: import('../../../shared/todo').TodoListCreateInput,
  ) => Promise<TodoListActionResult>;
  updateList: (input: TodoListUpdateInput & { listId: string }) => Promise<TodoListActionResult>;
  deleteList: (listId: string) => Promise<{ success: boolean; error?: string }>;
  createStep: (input: TodoStepCreateInput) => Promise<TodoStepActionResult>;
  updateStep: (input: TodoStepUpdateInput) => Promise<TodoStepActionResult>;
  deleteStep: (stepId: string) => Promise<{ success: boolean; error?: string }>;
  onChanged: (callback: (event: TodoChangedEvent) => void) => () => void;
};

export interface AgentsApi {
  list: () => Promise<Agent[]>;
  get: (id: string) => Promise<Agent | null>;
  create: (request: {
    id?: string;
    name: string;
    description?: string;
    systemPrompt?: string;
    identity?: string;
    model?: string;
    workingDirectory?: string;
    icon?: string;
    skillIds?: string[];
    source?: string;
    presetId?: string;
  }) => Promise<Agent>;
  update: (
    id: string,
    updates: {
      name?: string;
      description?: string;
      systemPrompt?: string;
      identity?: string;
      model?: string;
      workingDirectory?: string;
      icon?: string;
      skillIds?: string[];
      enabled?: boolean;
      pinned?: boolean;
    },
  ) => Promise<Agent>;
  delete: (id: string) => Promise<boolean>;
  importExpertPackage: ProvidersContractApi['agentsImportExpertPackage'];
  getPresetExperts: ProvidersContractApi['agentsGetPresetExperts'];
}
