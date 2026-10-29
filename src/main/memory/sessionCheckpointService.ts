/**
 * Agent-authored session checkpoints: write path, identity and the
 * deterministic fallback when the model never calls session_summary.
 *
 * A checkpoint is immutable per-turn content (not an LLM re-extraction of the
 * transcript). The host injects session/run/turn identity, evidence scope and
 * the format version; the model only supplies the text fields.
 */
import type { ProjectMemoryService } from './projectMemoryService';

const SESSION_CHECKPOINT_FORMAT_VERSION = 1;

export interface SessionCheckpointInput {
  goal: string;
  instructions?: string;
  discoveries?: string[];
  accomplished: string;
  nextSteps?: string[];
  relevantFiles?: Array<{ path: string; role?: string }>;
}

export interface SessionCheckpointContext {
  sessionId: string;
  workingDirectory: string;
  runId?: string | null;
  turnId?: string | null;
}

export function composeCheckpointContent(input: SessionCheckpointInput): string {
  const sections: string[] = [`## Goal\n${input.goal}`];
  if (input.instructions?.trim()) sections.push(`## Instructions\n${input.instructions.trim()}`);
  if (input.discoveries?.length)
    sections.push(`## Discoveries\n${input.discoveries.map(item => `- ${item}`).join('\n')}`);
  sections.push(`## Accomplished\n${input.accomplished}`);
  if (input.nextSteps?.length)
    sections.push(`## Next Steps\n${input.nextSteps.map(item => `- ${item}`).join('\n')}`);
  if (input.relevantFiles?.length)
    sections.push(
      `## Relevant Files\n${input.relevantFiles
        .map(file => `- ${file.path}${file.role ? ` — ${file.role}` : ''}`)
        .join('\n')}`,
    );
  return sections.join('\n\n');
}

export async function recordSessionCheckpoint(
  service: ProjectMemoryService,
  context: SessionCheckpointContext,
  input: SessionCheckpointInput,
): Promise<{ checkpointId: string; syncState: 'pending' | 'synced' | 'superseded' }> {
  const checkpointId = `${context.sessionId}:${context.turnId ?? 'session'}`;
  return await service.saveSessionSummary({
    sessionId: context.sessionId,
    workingDirectory: context.workingDirectory,
    summary: composeCheckpointContent(input),
    linkId: checkpointId,
    metadata: {
      format: 'agent-checkpoint',
      formatVersion: SESSION_CHECKPOINT_FORMAT_VERSION,
      runId: context.runId ?? null,
      turnId: context.turnId ?? null,
    },
  });
}

export interface SessionCheckpointFallbackInput {
  sessionId: string;
  workingDirectory: string;
  runId?: string | null;
  turnId?: string | null;
  goal: string;
  finalAnswer: string;
  verificationStatus?: string;
  artifactReferences?: string[];
}

/** Deterministic, zero-LLM fallback: an unreviewed run record, never a
 * promoted long-term fact. Only goal, final-answer excerpt, verification
 * status and the artifact ledger — no semantic inference. */
export async function recordCheckpointFallback(
  service: ProjectMemoryService,
  input: SessionCheckpointFallbackInput,
): Promise<void> {
  const content = [
    '## Goal',
    input.goal,
    '',
    '## Final answer (raw excerpt, unreviewed)',
    input.finalAnswer.slice(0, 2000),
    '',
    `## Verification status\n${input.verificationStatus ?? 'unknown'}`,
    ...(input.artifactReferences?.length
      ? [`## Artifacts\n${input.artifactReferences.map(item => `- ${item}`).join('\n')}`]
      : []),
    '',
    '_Source: deterministic fallback recorded because the model did not write a session checkpoint. Not a confirmed long-term fact._',
  ].join('\n');
  await service.saveSessionSummary({
    sessionId: input.sessionId,
    workingDirectory: input.workingDirectory,
    summary: content,
    linkId: `${input.sessionId}:fallback:${input.turnId ?? input.runId ?? 'session'}`,
    metadata: {
      format: 'fallback-run-record',
      formatVersion: SESSION_CHECKPOINT_FORMAT_VERSION,
      runId: input.runId ?? null,
      turnId: input.turnId ?? null,
      reviewRequired: true,
    },
  });
}
