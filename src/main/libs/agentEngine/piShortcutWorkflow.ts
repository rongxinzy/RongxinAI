import * as fs from 'fs';
import path from 'path';

import {
  collectShortcutCompletionFailures,
  expectedExtensions,
  isValidRasterPreview,
  isValidOfficePackage,
  isSafePublicUrl,
  normalizeResearchSourceUrl,
  previewExtensions,
  requiresRenderedPreview,
  ShortcutWorkflowKind,
  validationExtensions,
  type WorkflowFileRole,
  type WorkflowState,
  workflowLabel,
} from './piShortcutWorkflowPolicy';

export { resolveShortcutWorkflowKind, ShortcutWorkflowKind } from './piShortcutWorkflowPolicy';

export interface ShortcutWorkflowEndDecision {
  shouldFinish: boolean;
  reason?: string;
  nextPrompt?: string;
}

export interface PiShortcutWorkflowOptions {
  sessionId: string;
  workspaceRoot: string;
  task: string;
  kind: ShortcutWorkflowKind;
}

const now = (): string => new Date().toISOString();

export class PiShortcutWorkflowController {
  readonly runDirectory: string;
  private readonly statePath: string;
  private state: WorkflowState;
  private readonly pendingResearcherRuns = new Map<string, number>();

  constructor(private readonly options: PiShortcutWorkflowOptions) {
    this.runDirectory = path.join(
      options.workspaceRoot,
      '.zhiyuan',
      'shortcut-workflows',
      options.sessionId,
    );
    this.statePath = path.join(this.runDirectory, 'state.json');
    fs.mkdirSync(this.runDirectory, { recursive: true });
    this.state = this.loadOrCreate();
    this.writeState();
  }

  get goal(): string {
    return `Produce a verified ${workflowLabel(this.options.kind)} for: ${this.state.task}`;
  }

  buildInitialPrompt(userPrompt: string): string {
    return [
      `## Controlled ${workflowLabel(this.options.kind)} workflow`,
      `Durable workflow state: ${this.runDirectory}`,
      'Do not finish after a plan, draft, or a claimed file path.',
      'Work until the workflow_state tool has recorded every required deliverable and verification artifact.',
      'Calling agent_loop done only requests completion; unmet gates automatically continue the workflow.',
      ...this.kindInstructions(),
      '',
      userPrompt,
    ].join('\n');
  }

  resumeForPrompt(task: string): void {
    if (this.state.status === 'running' || this.state.status === 'completion_requested') return;
    this.state.status = 'running';
    this.state.task = task;
    this.state.iteration += 1;
    this.state.staleCount = 0;
    this.state.files = [];
    this.state.researchAngles = [];
    this.state.sources = [];
    this.state.researcherRuns = 0;
    this.pendingResearcherRuns.clear();
    delete this.state.completionReason;
    this.writeState();
  }

  requestCompletion(reason: string): string {
    this.state.status = 'completion_requested';
    this.state.completionReason = reason;
    this.writeState();
    return 'Completion recorded as a request. The workflow remains active until every required deliverable and verification artifact is independently checked.';
  }

  onAgentEnd(): ShortcutWorkflowEndDecision {
    const failures = collectShortcutCompletionFailures(this.state);
    if (this.state.status === 'completion_requested' && failures.length === 0) {
      this.state.status = 'completed';
      this.writeState();
      return { shouldFinish: true, reason: this.state.completionReason || 'Workflow gates passed' };
    }
    this.state.status =
      failures.length > 0 && this.state.iteration >= 15 ? 'needs_attention' : 'running';
    this.state.staleCount += 1;
    this.state.iteration += 1;
    this.writeState();
    return {
      shouldFinish: false,
      nextPrompt: [
        `## ${workflowLabel(this.options.kind)} workflow continuation`,
        'The previous turn did not clear the completion gate. Continue work; do not merely describe what remains.',
        'Missing requirements:',
        ...failures.map(failure => `- ${failure}`),
        ...this.kindInstructions(),
      ].join('\n'),
    };
  }

  recordSubagentStart(toolCallId: string, args: unknown): void {
    if (
      this.options.kind !== ShortcutWorkflowKind.DeepResearch ||
      !args ||
      typeof args !== 'object'
    )
      return;
    const raw = args as Record<string, unknown>;
    const count = [raw, ...(Array.isArray(raw.parallel) ? raw.parallel : [])].filter(
      value => (value as Record<string, unknown>).agent === 'researcher',
    ).length;
    if (count > 0) this.pendingResearcherRuns.set(toolCallId, count);
  }

  recordSubagentResult(toolCallId: string, output: string, isError: boolean): void {
    const requested = this.pendingResearcherRuns.get(toolCallId) || 0;
    this.pendingResearcherRuns.delete(toolCallId);
    if (requested === 0 || isError || !output.trim()) return;
    const parallelSuccesses = [...output.matchAll(/^## researcher \(ok\)$/gm)].length;
    const isParallelOutput = /^\d+\/\d+ subagents succeeded\./.test(output.trim());
    const failed = /^(Error:|\(subagent timed out|Subagent ".*" failed:|Unknown agent)/i.test(
      output.trim(),
    );
    const succeeded = isParallelOutput ? parallelSuccesses : failed ? 0 : 1;
    this.state.researcherRuns += Math.min(requested, succeeded);
    this.writeState();
  }

  async recordFile(
    rawPath: string,
    role: WorkflowFileRole,
    rawDeliverablePath?: string,
  ): Promise<string> {
    const resolved = this.resolveWorkspacePath(rawPath);
    if (!resolved)
      return 'File was not recorded: use an existing file inside the selected workspace.';
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size === 0)
      return 'File was not recorded: it is missing, not a file, or empty.';
    const extension = path.extname(resolved).toLowerCase();
    const allowedExtensions =
      role === 'deliverable'
        ? expectedExtensions(this.options.kind)
        : role === 'validation'
          ? validationExtensions
          : requiresRenderedPreview(this.options.kind)
            ? previewExtensions
            : [];
    if (!allowedExtensions.includes(extension)) {
      return `File was not recorded: role "${role}" expects one of ${allowedExtensions.join(', ')}.`;
    }
    if (role === 'preview' && !isValidRasterPreview(resolved)) {
      return 'File was not recorded: preview is not a valid raster image.';
    }
    if (role === 'deliverable') {
      if (
        (
          [
            ShortcutWorkflowKind.Ppt,
            ShortcutWorkflowKind.Docs,
            ShortcutWorkflowKind.Sheets,
          ] as ShortcutWorkflowKind[]
        ).includes(this.options.kind) &&
        ['.pptx', '.docx', '.xlsx', '.xlsm'].includes(path.extname(resolved).toLowerCase()) &&
        !(await isValidOfficePackage(resolved, this.options.kind))
      ) {
        return 'File was not recorded: the Office deliverable is not a valid ZIP package.';
      }
    }
    const normalized = path.relative(this.options.workspaceRoot, resolved);
    let deliverablePath: string | undefined;
    if (role !== 'deliverable') {
      const deliverable = this.resolveWorkspacePath(rawDeliverablePath || '');
      if (!deliverable)
        return 'File was not recorded: validation and preview files must name an existing workspace deliverable.';
      deliverablePath = path.relative(this.options.workspaceRoot, deliverable);
      if (
        !this.state.files.some(
          file => file.role === 'deliverable' && file.path === deliverablePath,
        )
      )
        return 'File was not recorded: record the referenced deliverable before its validation or preview.';
    }
    const index = this.state.files.findIndex(
      file => file.path === normalized && file.role === role,
    );
    const value = { path: normalized, role, deliverablePath, verifiedAt: now() };
    if (index >= 0) this.state.files[index] = value;
    else this.state.files.push(value);
    this.writeState();
    return `Verified ${role} file: ${normalized}`;
  }

  setResearchPlan(angles: string[]): string {
    if (this.options.kind !== ShortcutWorkflowKind.DeepResearch)
      return 'Research plans apply only to deep research.';
    const unique = [...new Set(angles.map(value => value.trim()).filter(Boolean))];
    if (unique.length < 3) return 'Deep research needs at least three distinct research angles.';
    this.state.researchAngles = unique;
    this.writeState();
    return `Recorded ${unique.length} research angles.`;
  }

  async verifySource(rawUrl: string): Promise<string> {
    if (this.options.kind !== ShortcutWorkflowKind.DeepResearch)
      return 'Sources apply only to deep research.';
    if (!isSafePublicUrl(rawUrl))
      return 'Source was not recorded: URL is unsafe or not public HTTP(S).';
    try {
      let current = new URL(rawUrl);
      for (let redirects = 0; redirects <= 5; redirects += 1) {
        const response = await fetch(current, {
          signal: AbortSignal.timeout(15_000),
          redirect: 'manual',
        });
        const location = response.headers.get('location');
        if (response.status >= 300 && response.status < 400 && location) {
          await response.body?.cancel();
          current = new URL(location, current);
          if (!isSafePublicUrl(current.toString())) {
            return 'Source was not recorded: redirect target is local, private, or unsafe.';
          }
          continue;
        }
        await response.body?.cancel();
        if (!response.ok) return `Source was not recorded: URL returned HTTP ${response.status}.`;
        const normalizedSource = normalizeResearchSourceUrl(current);
        if (!this.state.sources.includes(normalizedSource))
          this.state.sources.push(normalizedSource);
        this.writeState();
        return `Verified and recorded source: ${normalizedSource}`;
      }
      return 'Source was not recorded: URL exceeded the redirect limit.';
    } catch (error) {
      return `Source was not recorded: fetch failed (${error instanceof Error ? error.message : String(error)}).`;
    }
  }

  getSnapshot(): Record<string, unknown> {
    return {
      ...this.state,
      completionFailures: collectShortcutCompletionFailures(this.state),
      runDirectory: this.runDirectory,
    };
  }

  private kindInstructions(): string[] {
    if (this.options.kind === ShortcutWorkflowKind.DeepResearch) {
      return [
        'Create at least three distinct research angles, launch researchers for them, record six reachable sources, save the final cited report as a Markdown file, and save a readable validation report before requesting completion.',
      ];
    }
    const output = expectedExtensions(this.options.kind).join(' or ');
    const instructions = [
      `Create the requested ${output} deliverable, then call workflow_state with role "deliverable" to verify it exists and is nonempty.`,
      'Write a nonempty validation report inside the workspace and record it with role "validation" and deliverablePath set to the deliverable it checked.',
    ];
    if (requiresRenderedPreview(this.options.kind)) {
      instructions.push(
        'Render the deliverable to at least one preview image, inspect it, and record that image with role "preview" and deliverablePath set to that deliverable.',
      );
    }
    return instructions;
  }

  private resolveWorkspacePath(rawPath: string): string | null {
    if (!rawPath.trim()) return null;
    const resolved = path.resolve(this.options.workspaceRoot, rawPath);
    const relative = path.relative(this.options.workspaceRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(resolved))
      return null;
    return resolved;
  }

  private loadOrCreate(): WorkflowState {
    try {
      if (fs.existsSync(this.statePath)) {
        const state = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as WorkflowState;
        if (
          state.version === 1 &&
          state.sessionId === this.options.sessionId &&
          state.kind === this.options.kind
        )
          return state;
      }
    } catch {}
    return {
      version: 1,
      sessionId: this.options.sessionId,
      kind: this.options.kind,
      task: this.options.task,
      status: 'running',
      iteration: 1,
      staleCount: 0,
      files: [],
      researchAngles: [],
      sources: [],
      researcherRuns: 0,
      updatedAt: now(),
    };
  }

  private writeState(): void {
    this.state.updatedAt = now();
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }
}
