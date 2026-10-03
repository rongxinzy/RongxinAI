/**
 * Slash commands for the Cowork (Work/Chat) composer. Mirrors the coding
 * workbench semantics: the menu offers completions while typing, and a
 * control command only counts when it is the whole input — anything else
 * passes through to the model untouched.
 */

export const CoworkSlashCommand = {
  Skill: 'skill',
  Compact: 'compact',
} as const;
export type CoworkSlashCommand = (typeof CoworkSlashCommand)[keyof typeof CoworkSlashCommand];

/** One fixed command offered by the composer's command menu. */
export interface CoworkSlashCommandItem {
  name: string;
  description: string;
  hint?: string;
}

/** One skill offered as a `/skill` argument. */
export interface CoworkSlashCommandOption {
  value: string;
  label: string;
  description?: string;
}

const SLASH_COMMAND_QUERY_PATTERN = /^\/([^\s]*)$/u;
const SLASH_COMMAND_ARGUMENT_PATTERN = /^\/([a-z][a-z0-9-]*)\s+(\S*)$/u;
const CONTROL_COMMAND_PATTERN = /^\/([a-z][a-z0-9-]*)$/u;
const SELECTION_COMMAND_PATTERN = /^\/([a-z][a-z0-9-]*)\s+(\S+)(?:\s+([\s\S]*))?$/u;

/** The command menu opens while the whole input is a leading slash token. */
export const coworkSlashCommandQuery = (prompt: string): string | null => {
  const match = SLASH_COMMAND_QUERY_PATTERN.exec(prompt);
  return match ? match[1] : null;
};

/**
 * Command name plus the single-token argument being typed. A command with
 * more than one argument (`/skill pdf write the docs`) is no longer a
 * selection prompt, so this returns null and the menu stays closed.
 */
export const coworkSlashCommandArgument = (
  prompt: string,
): { name: string; query: string } | null => {
  const match = SLASH_COMMAND_ARGUMENT_PATTERN.exec(prompt);
  return match ? { name: match[1], query: match[2] } : null;
};

/** Commands matching the query, name matches before description matches. */
export const filterCoworkSlashCommands = (
  commands: CoworkSlashCommandItem[],
  query: string,
): CoworkSlashCommandItem[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return commands;
  return commands
    .map((command, index) => {
      const name = command.name.toLocaleLowerCase();
      const description = command.description.toLocaleLowerCase();
      const relevance = name.startsWith(normalizedQuery)
        ? 0
        : name.includes(normalizedQuery)
          ? 1
          : description.includes(normalizedQuery)
            ? 2
            : null;
      return { command, index, relevance };
    })
    .filter(
      (candidate): candidate is typeof candidate & { relevance: number } =>
        candidate.relevance !== null,
    )
    .sort((left, right) => left.relevance - right.relevance || left.index - right.index)
    .map(candidate => candidate.command);
};

/** Selection entries matching the argument, exact matches first. */
export const filterCoworkSlashOptions = (
  options: CoworkSlashCommandOption[],
  query: string,
): CoworkSlashCommandOption[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return options;
  return options
    .map((option, index) => {
      const value = option.value.toLocaleLowerCase();
      const label = option.label.toLocaleLowerCase();
      const relevance =
        value === normalizedQuery
          ? 0
          : value.startsWith(normalizedQuery) || label.startsWith(normalizedQuery)
            ? 1
            : value.includes(normalizedQuery) ||
                label.includes(normalizedQuery) ||
                (option.description?.toLocaleLowerCase().includes(normalizedQuery) ?? false)
              ? 2
              : null;
      return { option, index, relevance };
    })
    .filter(
      (candidate): candidate is typeof candidate & { relevance: number } =>
        candidate.relevance !== null,
    )
    .sort((left, right) => left.relevance - right.relevance || left.index - right.index)
    .map(candidate => candidate.option);
};

/** Text inserted when a command is chosen; a hint means an argument follows. */
export const coworkSlashCommandPrompt = (command: CoworkSlashCommandItem): string =>
  `/${command.name}${command.hint ? ' ' : ''}`;

/** Text inserted when a selection entry is chosen. */
export const coworkSlashSelectionPrompt = (name: string, value: string): string =>
  `/${name} ${value} `;

export const buildCoworkSlashCommands = (
  availability: { skills: boolean; compact: boolean },
  text: { skillDescription: string; skillHint: string; compactDescription: string },
): CoworkSlashCommandItem[] => [
  ...(availability.skills
    ? [
        {
          name: CoworkSlashCommand.Skill as string,
          description: text.skillDescription,
          hint: text.skillHint,
        },
      ]
    : []),
  ...(availability.compact
    ? [{ name: CoworkSlashCommand.Compact as string, description: text.compactDescription }]
    : []),
];

export type ParsedCoworkSlashSubmission =
  | { kind: 'compact' }
  | { kind: 'skill'; skillId: string; body: string }
  | { kind: 'prompt'; prompt: string };

export interface CoworkSlashParseContext {
  /** Enabled skill ids selectable through `/skill`. */
  skillIds: readonly string[];
  /** `/compact` is a control command only with a current session to compact. */
  compactAvailable: boolean;
}

const passthrough = (raw: string): ParsedCoworkSlashSubmission => ({
  kind: 'prompt',
  prompt: raw,
});

/**
 * Submit-time parsing. `/compact` runs only as the whole input; `/skill <id>`
 * activates the skill (an id that is not enabled passes through untouched,
 * exactly like any unknown slash command, so a typo never silently changes
 * the session); `/skill <id> <body>` also sends the body as the prompt.
 */
export const parseCoworkSlashSubmission = (
  raw: string,
  context: CoworkSlashParseContext,
): ParsedCoworkSlashSubmission => {
  const trimmed = raw.trim();
  const control = CONTROL_COMMAND_PATTERN.exec(trimmed);
  if (control && control[1] === CoworkSlashCommand.Compact && context.compactAvailable) {
    return { kind: 'compact' };
  }
  const selection = SELECTION_COMMAND_PATTERN.exec(trimmed);
  if (
    selection &&
    selection[1] === CoworkSlashCommand.Skill &&
    context.skillIds.includes(selection[2])
  ) {
    return { kind: 'skill', skillId: selection[2], body: (selection[3] ?? '').trim() };
  }
  return passthrough(raw);
};
