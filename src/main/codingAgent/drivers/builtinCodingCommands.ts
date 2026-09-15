import type {
  CodingAgentAvailableCommand,
  CodingAgentAvailableCommandOption,
} from '../../../shared/codingAgent';
import { t } from '../../i18n';

/** Slash commands the built-in coding agent parses out of a prompt itself. */
export const BuiltinCodingCommand = {
  Plan: 'plan',
  Goal: 'goal',
  Skill: 'skill',
  Expert: 'expert',
} as const;
export type BuiltinCodingCommand = (typeof BuiltinCodingCommand)[keyof typeof BuiltinCodingCommand];

/**
 * Slash commands the built-in coding agent runs as local control actions.
 * They never reach the model, so they carry no argument and no prompt text.
 */
export const BuiltinCodingControlCommand = {
  Compact: 'compact',
  Mcp: 'mcp',
  Status: 'status',
} as const;
export type BuiltinCodingControlCommand =
  (typeof BuiltinCodingControlCommand)[keyof typeof BuiltinCodingControlCommand];

/**
 * Argument that clears the skill or expert selected for the live session. An
 * installed entry with this exact id takes precedence over clearing.
 */
export const BuiltinCodingSelectionOff = 'off';

/** One installed skill, expert or MCP server offered after its command. */
export interface BuiltinCodingCommandChoice {
  id: string;
  name: string;
  description: string;
}

/** Everything the command menu can offer beyond the fixed commands. */
export interface BuiltinCodingCommandChoices {
  skills: BuiltinCodingCommandChoice[];
  experts: BuiltinCodingCommandChoice[];
  mcpServers: BuiltinCodingCommandChoice[];
}

export const EMPTY_BUILTIN_CODING_COMMAND_CHOICES: BuiltinCodingCommandChoices = {
  skills: [],
  experts: [],
  mcpServers: [],
};

const buildChoiceOptions = (
  choices: BuiltinCodingCommandChoice[],
): CodingAgentAvailableCommandOption[] =>
  choices.map(choice => ({
    value: choice.id,
    label: choice.name || choice.id,
    ...(choice.description ? { description: choice.description } : {}),
  }));

const buildSelectionOptions = (
  choices: BuiltinCodingCommandChoice[],
  offLabel: string,
): CodingAgentAvailableCommandOption[] => [
  ...buildChoiceOptions(choices),
  // Clearing stays last so an empty query keeps the first selectable entry. An
  // installed entry that already owns the reserved argument drops it: two rows
  // with the same value would render as duplicates and both select the same id.
  ...(choices.some(choice => choice.id === BuiltinCodingSelectionOff)
    ? []
    : [{ value: BuiltinCodingSelectionOff, label: offLabel }]),
];

/** `/name` plus an optional body; unknown text is left untouched. */
const COMMAND_PATTERN = /^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/u;

/** A bare `/name` with no arguments at all. */
const CONTROL_COMMAND_PATTERN = /^\/([a-z][a-z0-9-]*)$/u;

/** `/skill <id>` or `/expert <id>`, with the turn body after the selection. */
const SELECTION_COMMAND_PATTERN = /^\/([a-z][a-z0-9-]*)\s+(\S+)(?:\s+([\s\S]*))?$/u;

const selectionKind = (name: string): ParsedBuiltinCodingSelection['kind'] | null => {
  if (name === BuiltinCodingCommand.Skill) return 'skill';
  if (name === BuiltinCodingCommand.Expert) return 'expert';
  return null;
};

/** Advertised once per session so the composer can offer the command menu. */
export const buildBuiltinCodingCommandList = (
  choices: BuiltinCodingCommandChoices = EMPTY_BUILTIN_CODING_COMMAND_CHOICES,
): CodingAgentAvailableCommand[] => [
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
  ...(choices.skills.length > 0
    ? [
        {
          name: BuiltinCodingCommand.Skill,
          description: t('codingAgentCommandSkillDescription'),
          input: {
            hint: t('codingAgentCommandSkillHint'),
            options: buildSelectionOptions(choices.skills, t('codingAgentCommandSkillNone')),
          },
        },
      ]
    : []),
  ...(choices.experts.length > 0
    ? [
        {
          name: BuiltinCodingCommand.Expert,
          description: t('codingAgentCommandExpertDescription'),
          input: {
            hint: t('codingAgentCommandExpertHint'),
            options: buildSelectionOptions(choices.experts, t('codingAgentCommandExpertNone')),
          },
        },
      ]
    : []),
  {
    name: BuiltinCodingControlCommand.Compact,
    description: t('codingAgentCommandCompact'),
  },
  {
    name: BuiltinCodingControlCommand.Status,
    description: t('codingAgentCommandStatus'),
  },
  {
    // `/mcp` reports state instead of changing it, so it stays advertised even
    // with no configured server: "no servers" and "every server is disabled"
    // are both answers the command exists to give.
    name: BuiltinCodingControlCommand.Mcp,
    description: t('codingAgentCommandMcpDescription'),
    input: {
      hint: t('codingAgentCommandMcpHint'),
      ...(choices.mcpServers.length > 0 ? { options: buildChoiceOptions(choices.mcpServers) } : {}),
    },
  },
];

/** `/mcp <name>`: the report is scoped to one configured server. */
const MCP_TARGET_PATTERN = /^\/mcp\s+(\S+)$/u;

export interface ParsedBuiltinCodingControlCommand {
  command: BuiltinCodingControlCommand;
  /** MCP server the report is scoped to; null reports on every server. */
  target: string | null;
}

/**
 * A control command is only recognized when it is the whole prompt: `/compact`
 * runs the compaction, `/compact the login module` stays a normal model prompt.
 * `/mcp` is the one command that takes an argument, because a report can be
 * scoped to one server; anything after that argument makes it a model prompt.
 */
export const parseBuiltinCodingControlCommand = (
  raw: string,
): ParsedBuiltinCodingControlCommand | null => {
  const trimmed = raw.trim();
  const mcp = MCP_TARGET_PATTERN.exec(trimmed);
  if (mcp) return { command: BuiltinCodingControlCommand.Mcp, target: mcp[1] };
  const match = CONTROL_COMMAND_PATTERN.exec(trimmed);
  if (!match) return null;
  return (Object.values(BuiltinCodingControlCommand) as string[]).includes(match[1])
    ? { command: match[1] as BuiltinCodingControlCommand, target: null }
    : null;
};

export interface ParsedBuiltinCodingSelection {
  kind: 'skill' | 'expert';
  /** Selected id, or null when the command clears the current selection. */
  id: string | null;
}

export interface ParsedBuiltinCodingPrompt {
  /** Prompt text forwarded to the in-process runtime. */
  prompt: string;
  /** Whether this turn must run inside the long-horizon goal loop. */
  goalMode: boolean;
  /** Whether this turn is a read-only planning turn. */
  planMode: boolean;
  /** Present only when the prompt selects or clears a skill or expert. */
  selection?: ParsedBuiltinCodingSelection;
}

export interface BuiltinCodingTurnMode {
  goalMode: boolean;
  planMode: boolean;
}

const passthroughPrompt = (raw: string): ParsedBuiltinCodingPrompt => ({
  prompt: raw,
  goalMode: false,
  planMode: false,
});

/**
 * `/skill <id> <task>` and `/expert <id> <task>` select a skill or expert for
 * the live session, and `off` clears the selection. A bare command or an id
 * that is not installed is passed through untouched, exactly like any other
 * unknown slash command, so a typo never silently changes the session.
 */
const parseSelectionCommand = (
  raw: string,
  choices: BuiltinCodingCommandChoices,
): ParsedBuiltinCodingPrompt | null => {
  const match = SELECTION_COMMAND_PATTERN.exec(raw.trim());
  if (!match) return null;
  const kind = selectionKind(match[1]);
  if (!kind) return null;
  const body = (match[3] ?? '').trim();
  if (!body) return null;
  const value = match[2];
  const installed = kind === 'skill' ? choices.skills : choices.experts;
  const selected = installed.find(choice => choice.id === value);
  if (selected) {
    return { prompt: body, goalMode: false, planMode: false, selection: { kind, id: selected.id } };
  }
  if (value === BuiltinCodingSelectionOff) {
    return { prompt: body, goalMode: false, planMode: false, selection: { kind, id: null } };
  }
  return null;
};

/**
 * A command only counts as the whole first token and only with a body: a bare
 * `/goal` or `/plan` is passed through unchanged so the model still receives
 * the text the user typed instead of an empty prompt.
 */
export const parseBuiltinCodingPrompt = (
  raw: string,
  choices: BuiltinCodingCommandChoices = EMPTY_BUILTIN_CODING_COMMAND_CHOICES,
): ParsedBuiltinCodingPrompt => {
  const selection = parseSelectionCommand(raw, choices);
  if (selection) return selection;
  const match = COMMAND_PATTERN.exec(raw.trim());
  if (!match) return passthroughPrompt(raw);
  const body = (match[2] ?? '').trim();
  if (!body) return passthroughPrompt(raw);
  if (match[1] === BuiltinCodingCommand.Goal) {
    return { prompt: body, goalMode: true, planMode: false };
  }
  if (match[1] === BuiltinCodingCommand.Plan) {
    return { prompt: body, goalMode: false, planMode: true };
  }
  return passthroughPrompt(raw);
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
