import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import { CoworkSessionMode } from '../../shared/cowork/constants';
import { CompanionUnavailableReason } from '../../shared/companion/constants';
import {
  companionTaskRequest,
  type CompanionTaskRequest,
  type CompanionTaskReceipt,
  type CompanionTaskProjection,
  type CompanionTaskResult,
} from '../../shared/companion/tasks';
import type { CompanionProfile } from '../../shared/companion/types';
import { WorkbenchExecutionStatus } from '../../shared/workbenchTask';
import {
  prepareCoworkSession,
  resolveCoworkStartExperts,
  resolveCoworkStartWorkspace,
  type CoworkSessionIpcDeps,
} from '../coworkIpc/sessionStart';
import type { MagpieModelService } from '../magpie/modelService';
import { companionInstructions } from './personas';
import { CompanionAttachments } from './attachments';
import { resolveCompanionTaskOwner } from './taskOwnership';

interface Row extends CompanionTaskReceipt {
  fingerprint: string;
}
interface Options {
  db: Database.Database;
  sessions: CoworkSessionIpcDeps;
  models: Pick<MagpieModelService, 'resolveAutomatic'>;
}

/** Ownership links only; canonical Cowork/Workbench tables remain the task and run authority. */
export class CompanionTasks {
  private revision = 0;
  readonly attachments: CompanionAttachments;
  constructor(private readonly options: Options) {
    this.attachments = new CompanionAttachments(options.db);
  }

  workspaces() {
    return this.options.sessions
      .getCoworkStore()
      .workspaces.listWorkspaces()
      .filter(workspace => !workspace.isHidden)
      .map(({ id, name }) => ({ id, name }));
  }

  /** Only the owned native directory dialog supplies this path. No renderer path argument. */
  async chooseWorkspace(selectedPath: string) {
    const directory = await realpath(selectedPath);
    if (!(await stat(directory)).isDirectory()) throw new Error('Workspace must be a directory');
    const workspaces = this.options.sessions.getCoworkStore().workspaces;
    const workspace = workspaces.ensureWorkspace(directory);
    if (workspace.isHidden) workspaces.setWorkspaceHidden(workspace.id, false);
    return { id: workspace.id, name: workspace.name };
  }

  onChanged(listener: (sessionId: string) => void): () => void {
    const changed = (event: { sessionId: string }) => listener(event.sessionId);
    const tasks = this.options.sessions.getWorkbenchTaskService();
    tasks.on('changed', changed);
    return () => {
      tasks.off('changed', changed);
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
    const parsed = companionTaskRequest.parse(input);
    // Reloaded drafts represent no selection as []; the same request must keep its receipt.
    const request = {
      ...parsed,
      attachmentIds: parsed.attachmentIds?.length ? parsed.attachmentIds : undefined,
    };
    if (request.petId !== profile.petId) throw new Error('Task belongs to another companion');
    const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const previous = this.find(profile.petId, request.requestId);
    if (previous) return this.existing(previous, fingerprint);
    const store = this.options.sessions.getCoworkStore();
    const workspace = store.workspaces.getWorkspace(request.workspaceId);
    if (!workspace || workspace.isHidden) throw new Error('Unknown task workspace');
    let model;
    try {
      model = await this.options.models.resolveAutomatic(undefined, { work: true });
    } catch {
      return { receipt: null, reason: CompanionUnavailableReason.ServiceUnavailable };
    }
    if (!model) return { receipt: null, reason: CompanionUnavailableReason.NoModel };
    const { fileAttachments } = await this.attachments.resolve(
      profile.petId,
      request.attachmentIds,
    );
    const modelPrompt = fileAttachments.length
      ? [
          request.text,
          'Files explicitly attached to this task (references only):',
          ...fileAttachments.map(({ name, path }) => JSON.stringify({ name, path })),
        ].join('\n\n')
      : undefined;
    const experts = await resolveCoworkStartExperts(this.options.sessions, {});
    const startWorkspace = await resolveCoworkStartWorkspace(this.options.sessions, {
      workspaceId: workspace.id,
      cwd: workspace.path,
    });

    const launch: { current?: () => void } = {};
    const modelId = model.modelId;
    const result = this.options.db.transaction((): CompanionTaskResult => {
      // Another request may have committed while model availability was being resolved.
      const existing = this.find(profile.petId, request.requestId);
      if (existing) return this.existing(existing, fingerprint);
      if (startWorkspace.workspace?.path !== workspace.path || startWorkspace.workspace.isHidden)
        throw new Error('Unknown task workspace');
      const prepared = prepareCoworkSession(
        this.options.sessions,
        {
          prompt: request.text,
          workspaceId: workspace.id,
          cwd: workspace.path,
          mode: CoworkSessionMode.Work,
          modelOverride: modelId,
          fileAttachments,
          systemPrompt: [store.getConfig().systemPrompt, companionInstructions(profile.personaId)]
            .filter(Boolean)
            .join('\n\n'),
        },
        {
          ...experts,
          modelPrompt,
          startWorkspace,
        },
      );
      if (!prepared.workbenchReservation) throw new Error('Companion Work run was not reserved');
      const receipt = {
        petId: profile.petId,
        requestId: request.requestId,
        sessionId: prepared.session.id,
        ...prepared.workbenchReservation,
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
    // Native input and its ownership receipt must commit before execution.
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
    return resolveCompanionTaskOwner(this.options.db, sessionId) === petId;
  }

  stop(petId: string, sessionId: string): void {
    if (!this.owned(petId, sessionId)) throw new Error('Task belongs to another companion');
    this.options.sessions.getPiRuntimeAdapter().stopSession(sessionId);
  }

  snapshot(petId: string) {
    return { petId, revision: ++this.revision, tasks: this.recent(petId) };
  }

  recent(petId: string): CompanionTaskProjection[] {
    const rows = this.options.db
      .prepare<[string], CompanionTaskReceipt & { title: string | null }>(`
        SELECT a.pet_id AS petId, a.request_id AS requestId, a.session_id AS sessionId,
          a.task_id AS taskId, a.run_id AS runId, s.title
        FROM companion_task_admissions a LEFT JOIN cowork_sessions s ON s.id = a.session_id
        WHERE a.pet_id = ? ORDER BY a.created_at DESC, a.rowid DESC LIMIT 12`)
      .all(petId);
    if (!rows.length) return [];
    const statuses = this.options.sessions
      .getWorkbenchTaskService()
      .repository.getLatestTaskStatuses(rows.map(row => row.sessionId));
    return rows.map(({ title, ...receipt }) => {
      const status = statuses.get(receipt.sessionId);
      return {
        receipt,
        title: title ?? '',
        status: status ?? WorkbenchExecutionStatus.Cancelled,
        missing: title === null || status === undefined,
      };
    });
  }
}
