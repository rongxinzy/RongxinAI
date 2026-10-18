/**
 * Agent preload surface, split from `../electron.d.ts`.
 *
 * Covers agent profiles/preset experts plus the per-session workbench task
 * and todo surfaces. `importExpertPackage` / `getPresetExperts` derive from
 * the zod IPC contract (`src/shared/ipc/providersContract.ts`); the
 * list/get/create/update/delete methods unwrap the success envelope in the
 * preload and keep their unwrapped signatures.
 */
import type {
  WorkbenchApprovalResponseInput,
  WorkbenchTaskActionResult,
  WorkbenchTaskChangedEvent,
  WorkbenchTaskExportResult,
  WorkbenchTaskListResult,
} from '../../../shared/workbenchTask';
import type { IpcContractApi } from '../../../shared/ipc/contract';
import type { providersContract } from '../../../shared/ipc/providersContract';
import type { Agent } from '../agent';

type ProvidersContractApi = IpcContractApi<typeof providersContract>;

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
      triageOverride?: import('../../../shared/triage').AgentTriageOverride | null;
    },
  ) => Promise<Agent>;
  delete: (id: string) => Promise<boolean>;
  importExpertPackage: ProvidersContractApi['agentsImportExpertPackage'];
  getPresetExperts: ProvidersContractApi['agentsGetPresetExperts'];
}

export interface WorkbenchTaskApi {
  getCurrent: (sessionId: string) => Promise<WorkbenchTaskActionResult>;
  getDetail: (taskId: string) => Promise<WorkbenchTaskActionResult>;
  listForSession: (sessionId: string) => Promise<WorkbenchTaskListResult>;
  exportAudit: (taskId: string) => Promise<WorkbenchTaskExportResult>;
  resume: (
    input: import('../../../shared/workbenchTask').WorkbenchTaskResumeInput,
  ) => Promise<WorkbenchTaskActionResult>;
  retry: (taskId: string) => Promise<WorkbenchTaskActionResult>;
  accept: (taskId: string) => Promise<WorkbenchTaskActionResult>;
  respondToApproval: (input: WorkbenchApprovalResponseInput) => Promise<WorkbenchTaskActionResult>;
  onChanged: (callback: (event: WorkbenchTaskChangedEvent) => void) => () => void;
}

export interface TodoApi {
  list: (
    input: import('../../../shared/todo').TodoListInput,
  ) => Promise<import('../../../shared/todo').TodoListResult>;
  create: (
    input: import('../../../shared/todo').TodoCreateInput,
  ) => Promise<import('../../../shared/todo').TodoActionResult>;
  update: (
    input: import('../../../shared/todo').TodoUpdateInput & { todoId: string },
  ) => Promise<import('../../../shared/todo').TodoActionResult>;
  delete: (todoId: string) => Promise<{ success: boolean; error?: string }>;
  listLists: () => Promise<import('../../../shared/todo').TodoListsResult>;
  createList: (
    input: import('../../../shared/todo').TodoListCreateInput,
  ) => Promise<import('../../../shared/todo').TodoListActionResult>;
  updateList: (
    input: import('../../../shared/todo').TodoListUpdateInput & { listId: string },
  ) => Promise<import('../../../shared/todo').TodoListActionResult>;
  deleteList: (listId: string) => Promise<{ success: boolean; error?: string }>;
  createStep: (
    input: import('../../../shared/todo').TodoStepCreateInput,
  ) => Promise<import('../../../shared/todo').TodoStepActionResult>;
  updateStep: (
    input: import('../../../shared/todo').TodoStepUpdateInput,
  ) => Promise<import('../../../shared/todo').TodoStepActionResult>;
  deleteStep: (stepId: string) => Promise<{ success: boolean; error?: string }>;
  onChanged: (
    callback: (event: import('../../../shared/todo').TodoChangedEvent) => void,
  ) => () => void;
}
