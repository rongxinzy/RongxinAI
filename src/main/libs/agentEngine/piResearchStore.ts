import * as fs from 'fs';
import path from 'path';

import {
  ResearchRunStatus,
  type PiResearchRunOptions,
  type ResearchRunState,
} from './piResearchTypes';

const RESEARCH_ROOT_DIR = '.zhiyuan/research';
const STATE_DIR = 'state';
const LOGS_DIR = 'logs';
const STATE_FILENAME = 'research-state.json';

const now = (): string => new Date().toISOString();

export class PiResearchRunStore {
  readonly runDirectory: string;
  private readonly stateDirectory: string;
  private readonly logsDirectory: string;
  private readonly statePath: string;

  constructor(private readonly options: PiResearchRunOptions) {
    this.runDirectory = path.join(options.workspaceRoot, RESEARCH_ROOT_DIR, options.sessionId);
    this.stateDirectory = path.join(this.runDirectory, STATE_DIR);
    this.logsDirectory = path.join(this.runDirectory, LOGS_DIR);
    this.statePath = path.join(this.runDirectory, STATE_FILENAME);
    this.ensureLayout();
  }

  loadOrCreate(): ResearchRunState {
    if (fs.existsSync(this.statePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as ResearchRunState;
        if (parsed.version === 1 && parsed.sessionId === this.options.sessionId) {
          return {
            ...parsed,
            researcherIterations: parsed.researcherIterations || [],
            claims: (parsed.claims || []).map(claim => ({
              ...claim,
              statement: claim.statement || '',
            })),
          };
        }
      } catch {
        this.log(
          'orchestrator',
          'warn',
          'state_parse_failed',
          'Existing state was unreadable; a fresh state was created.',
        );
      }
    }
    return {
      version: 1,
      sessionId: this.options.sessionId,
      task: this.options.task,
      status: ResearchRunStatus.Running,
      iteration: 1,
      staleCount: 0,
      lastFindingCount: 0,
      researcherIterations: [],
      subquestions: [],
      sources: [],
      claims: [],
      directionsTried: [],
      review: { requested: false, passed: false },
      updatedAt: now(),
    };
  }

  writeState(state: ResearchRunState): void {
    state.updatedAt = now();
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2));
    fs.writeFileSync(
      path.join(this.stateDirectory, 'progress.json'),
      JSON.stringify(
        {
          iteration: state.iteration,
          total_findings: state.sources.length + state.claims.length,
          status: state.status,
          stale_count: state.staleCount,
        },
        null,
        2,
      ),
    );
    this.appendJsonl(path.join(this.stateDirectory, 'iteration_log.jsonl'), {
      ts: now(),
      iteration: state.iteration,
      status: state.status,
      sources: state.sources.length,
      claims: state.claims.length,
      staleCount: state.staleCount,
    });
  }

  appendFinding(value: unknown): void {
    this.appendJsonl(path.join(this.stateDirectory, 'findings.jsonl'), value);
  }

  writeDirections(directions: string[]): void {
    fs.writeFileSync(
      path.join(this.stateDirectory, 'directions_tried.json'),
      JSON.stringify(directions, null, 2),
    );
  }

  log(source: string, level: string, event: string, detail: string): void {
    this.appendJsonl(path.join(this.logsDirectory, 'orchestrator.jsonl'), {
      ts: now(),
      source,
      level,
      event,
      detail,
    });
  }

  private ensureLayout(): void {
    fs.mkdirSync(this.stateDirectory, { recursive: true });
    fs.mkdirSync(this.logsDirectory, { recursive: true });
    const taskSpecPath = path.join(this.stateDirectory, 'task_spec.md');
    if (!fs.existsSync(taskSpecPath)) {
      fs.writeFileSync(
        taskSpecPath,
        `# Academic research task\n\nSession: ${this.options.sessionId}\n\n${this.options.task}\n`,
      );
    }
    for (const file of ['findings.jsonl', 'iteration_log.jsonl']) {
      const filePath = path.join(this.stateDirectory, file);
      if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '');
    }
    const directionsPath = path.join(this.stateDirectory, 'directions_tried.json');
    if (!fs.existsSync(directionsPath)) fs.writeFileSync(directionsPath, '[]\n');
    for (const file of ['work.jsonl', 'orchestrator.jsonl', 'heartbeat.jsonl']) {
      const filePath = path.join(this.logsDirectory, file);
      if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '');
    }
  }

  private appendJsonl(filePath: string, value: unknown): void {
    fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
  }
}
