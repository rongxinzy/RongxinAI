import type { CodingAgentAvailableCommand } from '../../../shared/codingAgent';
import { t } from '../../i18n';

/** Slash commands the built-in coding agent parses out of a prompt itself. */
export const BuiltinCodingCommand = {
  Plan: 'plan',
  Goal: 'goal',
} as const;
export type BuiltinCodingCommand = (typeof BuiltinCodingCommand)[keyof typeof BuiltinCodingCommand];

/**
 * Slash commands the built-in coding agent runs as local control actions.
 * They never reach the model, so they carry no argument and no prompt text.
 */
export const BuiltinCodingControlCommand = {
  Compact: 'compact',
  Status: 'status',
} as const;
export type BuiltinCodingControlCommand =
  (typeof BuiltinCodingControlCommand)[keyof typeof BuiltinCodingControlCommand];

/** `/name` plus an optional body; unknown text is left untouched. */
const COMMAND_PATTERN = /^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/u;

/** A bare `/name` with no arguments at all. */
const CONTROL_COMMAND_PATTERN = /^\/([a-z][a-z0-9-]*)$/u;

/** Advertised once per session so the composer can offer the command menu. */
export const buildBuiltinCodingCommandList = (): CodingAgentAvailableCommand[] => [
  {
    name: BuiltinCodingCommand.Plan,
    description: t('codingAgentCommandPlanDescription'),
    input: { hint: t('codingAgentCommandPlanHint') },
  },
  {
    name: BuiltinCodingCommand.Goal,
    description: t('codingAgentCommandGoalDescription'),
    input: { hint: t('codingAgentCommandGoalHint') },
  },
  {
    name: BuiltinCodingControlCommand.Compact,
    description: t('codingAgentCommandCompact'),
  },
  {
    name: BuiltinCodingControlCommand.Status,
    description: t('codingAgentCommandStatus'),
  },
];

/**
 * A control command is only recognized when it is the whole prompt: `/compact`
 * runs the compaction, `/compact the login module` stays a normal model prompt.
 */
export const parseBuiltinCodingControlCommand = (
  raw: string,
): BuiltinCodingControlCommand | null => {
  const match = CONTROL_COMMAND_PATTERN.exec(raw.trim());
  if (!match) return null;
  return (Object.values(BuiltinCodingControlCommand) as string[]).includes(match[1])
    ? (match[1] as BuiltinCodingControlCommand)
    : null;
};

export interface ParsedBuiltinCodingPrompt {
  /** Prompt text forwarded to the in-process runtime. */
  prompt: string;
  /** Whether this turn must run inside the long-horizon goal loop. */
  goalMode: boolean;
  /** Whether this turn is a read-only planning turn. */
  planMode: boolean;
}

export interface BuiltinCodingTurnMode {
  goalMode: boolean;
  planMode: boolean;
}

/**
 * A command only counts as the whole first token and only with a body: a bare
 * `/goal` or `/plan` is passed through unchanged so the model still receives
 * the text the user typed instead of an empty prompt.
 */
export const parseBuiltinCodingPrompt = (raw: string): ParsedBuiltinCodingPrompt => {
  const match = COMMAND_PATTERN.exec(raw.trim());
  if (!match) return { prompt: raw, goalMode: false, planMode: false };
  const body = (match[2] ?? '').trim();
  if (!body) return { prompt: raw, goalMode: false, planMode: false };
  if (match[1] === BuiltinCodingCommand.Goal) {
    return { prompt: body, goalMode: true, planMode: false };
  }
  if (match[1] === BuiltinCodingCommand.Plan) {
    return { prompt: body, goalMode: false, planMode: true };
  }
  return { prompt: raw, goalMode: false, planMode: false };
};

/**
 * The slash command wins over the session mode, and the two commands are
 * mutually exclusive: an explicit goal is an execution request, so it clears
 * the session's read-only planning mode instead of stalling the goal loop.
 */
export const resolveBuiltinCodingTurnMode = (
  parsed: ParsedBuiltinCodingPrompt,
  sessionPlanMode: boolean,
): BuiltinCodingTurnMode => {
  if (parsed.goalMode) return { goalMode: true, planMode: false };
  return { goalMode: false, planMode: parsed.planMode || sessionPlanMode };
};
