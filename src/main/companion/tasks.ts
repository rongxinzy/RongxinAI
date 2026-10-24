import { createHash, randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import { CoworkSessionMode, CoworkPermissionMode } from '../../shared/cowork/constants';
import { CompanionUnavailableReason } from '../../shared/companion/constants';
import {
  companionTaskRequest,
  type CompanionTaskRequest,
  type CompanionTaskReceipt,
  type CompanionTaskProjection,
  type CompanionTaskResult,
} from '../../shared/companion/tasks';
import type { CompanionProfile } from '../../shared/companion/types';
import {
  WorkbenchRunStatus,
  WorkbenchRunTrigger,
  WorkbenchTaskStatus,
} from '../../shared/workbenchTask';
import { prepareCoworkSession, type CoworkSessionIpcDeps } from '../coworkIpc/sessionStart';
import type { MagpieModelService } from '../magpie/modelService';
import type { WorkbenchTaskService } from '../workbenchTask/taskService';
import { createPiWorkbenchContract } from '../libs/agentEngine/piRuntimeWorkbenchContract';
import { companionInstructions } from './personas';

interface Row extends CompanionTaskReceipt {
  fingerprint: string;
}
interface Options {
  db: Database.Database;
  sessions: CoworkSessionIpcDeps;
  models: Pick<MagpieModelService, 'resolveAutomatic'>;
  tasks: WorkbenchTaskService;
}

/** Ownership links only; canonical Cowork/Workbench tables remain the task and run authority. */
export class CompanionTasks {
  private revision = 0;
  constructor(private readonly options: Options) {
    options.db.exec(`CREATE TABLE IF NOT EXISTS companion_task_admissions (
      pet_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
      session_id TEXT NOT NULL, task_id TEXT NOT NULL, run_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, PRIMARY KEY (pet_id, request_id)
    ); CREATE INDEX IF NOT EXISTS companion_task_admissions_recent
      ON companion_task_admissions(pet_id, created_at DESC);`);
    // Queued work left by a previous process never silently replays external effects.
    const queued = options.db
      .prepare(`SELECT a.session_id AS sessionId FROM companion_task_admissions a
      JOIN workbench_runs r ON r.id = a.run_id
      JOIN workbench_tasks t ON t.id = a.task_id AND t.active_run_id = r.id WHERE r.status = ?`)
      .all(WorkbenchRunStatus.Queued) as { sessionId: string }[];
    for (const { sessionId } of queued)
      options.tasks.failRun(sessionId, {
        message: 'Task admission was interrupted before execution.',
      });
  }

  workspaces() {
    return this.options.sessions
      .getCoworkStore()
      .listWorkspaces()
      .filter(workspace => !workspace.isHidden)
      .map(({ id, name }) => ({ id, name }));
  }

  /** Only the owned native directory dialog supplies this path. No renderer path argument. */
  async chooseWorkspace(selectedPath: string) {
    const directory = await realpath(selectedPath);
    if (!(await stat(directory)).isDirectory()) throw new Error('Workspace must be a directory');
    const store = this.options.sessions.getCoworkStore();
    const workspace = store.ensureWorkspace(directory);
    if (workspace.isHidden) store.setWorkspaceHidden(workspace.id, false);
    return { id: workspace.id, name: workspace.name };
  }

  onChanged(listener: (sessionId: string) => void): () => void {
    const changed = (event: { sessionId: string }) => listener(event.sessionId);
    this.options.tasks.on('changed', changed);
    return () => {
      this.options.tasks.off('changed', changed);
    };
  }

  private find(petId: string, requestId: string): Row | undefined {
    return this.options.db
      .prepare(`SELECT pet_id AS petId, request_id AS requestId,
      fingerprint, session_id AS sessionId, task_id AS taskId, run_id AS runId
      FROM companion_task_admissions WHERE pet_id = ? AND request_id = ?`)
      .get(petId, requestId) as Row | undefined;
  }

  private receipt(row: Row): CompanionTaskReceipt {
    const { fingerprint: _fingerprint, ...receipt } = row;
    return receipt;
  }

  async submit(
    profile: CompanionProfile,
    input: CompanionTaskRequest,
  ): Promise<CompanionTaskResult> {
    const request = companionTaskRequest.parse(input);
    if (request.petId !== profile.petId) throw new Error('Task belongs to another companion');
    const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const previous = this.find(profile.petId, request.requestId);
    if (previous) return this.existing(previous, fingerprint);
    const store = this.options.sessions.getCoworkStore();
    const workspace = store.getWorkspace(request.workspaceId);
    if (!workspace || workspace.isHidden) throw new Error('Unknown task workspace');
    let model;
    try {
      model = await this.options.models.resolveAutomatic();
    } catch {
      return { receipt: null, reason: CompanionUnavailableReason.ServiceUnavailable };
    }
    if (!model) return { receipt: null, reason: CompanionUnavailableReason.NoModel };

    const launch: { current?: () => void } = {};
    const modelId = model.model.id;
    const result = this.options.db.transaction((): CompanionTaskResult => {
      // Another request may have committed while model availability was being resolved.
      const existing = this.find(profile.petId, request.requestId);
      if (existing) return this.existing(existing, fingerprint);
      const sessionId = randomUUID();
      const repository = this.options.tasks.repository;
      const task = repository.createTask(
        sessionId,
        request.text,
        createPiWorkbenchContract(CoworkSessionMode.Work, []),
      );
      const run = repository.createRun(task.id, WorkbenchRunTrigger.Message);
      repository.updateTaskStatus(task.id, WorkbenchTaskStatus.Planned, run.id);
      repository.updateTaskStatus(task.id, WorkbenchTaskStatus.Running, run.id);
      const prepared = prepareCoworkSession(
        this.options.sessions,
        {
          prompt: request.text,
          workspaceId: workspace.id,
          cwd: workspace.path,
          mode: CoworkSessionMode.Work,
          modelOverride: modelId,
          // Keep the existing user permission choice. Personality never grants authority.
          permissionMode: store.getConfig().permissionMode ?? CoworkPermissionMode.Ask,
          systemPrompt: [store.getConfig().systemPrompt, companionInstructions(profile.personaId)]
            .filter(Boolean)
            .join('\n\n'),
        },
        {
          sessionId,
          workbenchRunId: run.id,
          onFailure: error =>
            this.options.tasks.failRun(sessionId, {
              message: error instanceof Error ? error.message : String(error),
            }),
        },
      );
      const receipt = {
        petId: profile.petId,
        requestId: request.requestId,
        sessionId: prepared.session.id,
        taskId: task.id,
        runId: run.id,
      };
      this.options.db
        .prepare(`INSERT INTO companion_task_admissions
        (pet_id, request_id, fingerprint, session_id, task_id, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(
          receipt.petId,
          receipt.requestId,
          fingerprint,
          receipt.sessionId,
          receipt.taskId,
          receipt.runId,
          Date.now(),
        );
      launch.current = prepared.launch;
      return { receipt };
    })();
    // Nothing reaches the execution adapter until all three records have committed.
    launch.current?.();
    return result;
  }

  private existing(row: Row, fingerprint: string): CompanionTaskResult {
    if (row.fingerprint !== fingerprint)
      throw new Error('Task request key was reused with different input');
    // A lost reply, a restart or deletion never replays the external work.
    return { receipt: this.receipt(row) };
  }

  owned(petId: string, sessionId: string): boolean {
    return Boolean(
      this.options.db
        .prepare('SELECT 1 FROM companion_task_admissions WHERE pet_id = ? AND session_id = ?')
        .get(petId, sessionId),
    );
  }

  stop(petId: string, sessionId: string): void {
    if (!this.owned(petId, sessionId)) throw new Error('Task belongs to another companion');
    this.options.sessions.getPiRuntimeAdapter().stopSession(sessionId);
    const task = this.options.tasks.getCurrent(sessionId)?.task;
    if (task?.activeRunId) this.options.tasks.cancelRun(sessionId, task.activeRunId);
  }

  snapshot(petId: string) {
    return { petId, revision: ++this.revision, tasks: this.recent(petId) };
  }

  recent(petId: string): CompanionTaskProjection[] {
    const rows = this.options.db
      .prepare(`SELECT pet_id AS petId, request_id AS requestId,
      fingerprint, session_id AS sessionId, task_id AS taskId, run_id AS runId
      FROM companion_task_admissions WHERE pet_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 12`)
      .all(petId) as Row[];
    return rows.map(row => {
      const session = this.options.sessions
        .getCoworkStore()
        .getSession(row.sessionId, 0, { includeArtifacts: false });
      const task = this.options.tasks.repository.getTask(row.taskId);
      const latest = this.options.db
        .prepare('SELECT id FROM workbench_runs WHERE task_id = ? ORDER BY attempt DESC LIMIT 1')
        .get(row.taskId) as { id: string } | undefined;
      const run = this.options.tasks.repository.getRun(
        task?.activeRunId ?? latest?.id ?? row.runId,
      );
      return {
        receipt: this.receipt(row),
        title: session?.title ?? '',
        status: run?.status ?? WorkbenchRunStatus.Cancelled,
        missing: !session || !task || !run,
      };
    });
  }
}
