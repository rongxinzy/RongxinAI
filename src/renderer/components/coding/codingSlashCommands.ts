import type { CodingAgentAvailableCommand } from '../../../shared/codingAgent';

const SLASH_COMMAND_QUERY_PATTERN = /^\/([^\s]*)$/u;

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
