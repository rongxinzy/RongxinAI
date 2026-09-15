import type {
  CodingAgentAvailableCommand,
  CodingAgentAvailableCommandOption,
} from '../../../shared/codingAgent';

const SLASH_COMMAND_QUERY_PATTERN = /^\/([^\s]*)$/u;
const SLASH_COMMAND_ARGUMENT_PATTERN = /^\/([a-z][a-z0-9-]*)\s+(\S*)$/u;

/**
 * Command name plus the single-token argument being typed. A command with more
 * than one argument (`/skill pdf write the docs`) is no longer a selection
 * prompt, so this returns null and the menu stays closed.
 */
export const slashCommandArgument = (prompt: string): { name: string; query: string } | null => {
  const match = SLASH_COMMAND_ARGUMENT_PATTERN.exec(prompt);
  return match ? { name: match[1], query: match[2] } : null;
};

/** Selection entries matching the argument, exact matches first. */
export const filterCommandOptions = (
  options: CodingAgentAvailableCommandOption[],
  query: string,
): CodingAgentAvailableCommandOption[] => {
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

/** Text inserted when a selection entry is chosen. */
export const slashCommandSelectionPrompt = (name: string, value: string): string =>
  `/${name} ${value} `;

export const slashCommandQuery = (prompt: string): string | null => {
  const match = SLASH_COMMAND_QUERY_PATTERN.exec(prompt);
  return match ? match[1] : null;
};

export const filterSlashCommands = (
  commands: CodingAgentAvailableCommand[],
  query: string,
): CodingAgentAvailableCommand[] => {
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

export const slashCommandPrompt = (command: CodingAgentAvailableCommand): string =>
  `/${command.name}${command.input?.hint ? ' ' : ''}`;
