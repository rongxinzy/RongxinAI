import type { CoworkSessionExpertSnapshot } from '../../shared/cowork/sessionExperts';
import { buildScheduledTaskEnginePrompt } from '../../scheduledTask/enginePrompt';
import {
  applyCoworkLanguagePrompt,
  type CoworkPromptLanguage,
  stripCoworkLanguagePrompts,
} from '../coworkLanguagePrompt';
import { CoworkManagedPromptMarker, ZhiyuanIdentityPrompt } from './constants';

type ExpertPromptSnapshot = Pick<CoworkSessionExpertSnapshot, 'promptSnapshot'>;

export interface ComposeCoworkSystemPromptOptions {
  basePrompt?: string;
  expertSnapshots?: ExpertPromptSnapshot[];
  previousExpertSnapshots?: ExpertPromptSnapshot[];
  language: CoworkPromptLanguage;
}

const removeDelimitedBlocks = (value: string, startMarker: string, endMarker: string): string => {
  let result = value;
  while (true) {
    const start = result.indexOf(startMarker);
    if (start < 0) return result;
    const end = result.indexOf(endMarker, start + startMarker.length);
    if (end < 0) return result.slice(0, start);
    result = `${result.slice(0, start)}${result.slice(end + endMarker.length)}`;
  }
};

const removeExactText = (value: string, text: string): string =>
  text ? value.split(text).join('') : value;

const normalizeSectionSpacing = (value: string): string =>
  value
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const managedBlock = (start: string, content: string, end: string): string =>
  [start, content, end].join('\n');

export const stripManagedCoworkPrompt = (
  systemPrompt: string | undefined,
  previousExpertSnapshots: ExpertPromptSnapshot[] = [],
): string => {
  let result = stripCoworkLanguagePrompts(systemPrompt || '');
  result = removeDelimitedBlocks(
    result,
    CoworkManagedPromptMarker.IdentityStart,
    CoworkManagedPromptMarker.IdentityEnd,
  );
  result = removeDelimitedBlocks(
    result,
    CoworkManagedPromptMarker.ScheduledTasksStart,
    CoworkManagedPromptMarker.ScheduledTasksEnd,
  );
  result = removeDelimitedBlocks(
    result,
    CoworkManagedPromptMarker.ExpertsStart,
    CoworkManagedPromptMarker.ExpertsEnd,
  );

  // Normalize sessions created before managed markers were introduced.
  result = removeExactText(result, ZhiyuanIdentityPrompt);
  result = removeExactText(result, buildScheduledTaskEnginePrompt());
  for (const expert of previousExpertSnapshots) {
    result = removeExactText(result, expert.promptSnapshot.trim());
  }
  return normalizeSectionSpacing(result);
};

export const composeCoworkSystemPrompt = ({
  basePrompt,
  expertSnapshots = [],
  previousExpertSnapshots = expertSnapshots,
  language,
}: ComposeCoworkSystemPromptOptions): string => {
  const normalizedBasePrompt = stripManagedCoworkPrompt(basePrompt, previousExpertSnapshots);
  const expertPrompt = expertSnapshots
    .map(expert => expert.promptSnapshot.trim())
    .filter(Boolean)
    .join('\n\n');
  const sections = [
    expertPrompt
      ? null
      : managedBlock(
          CoworkManagedPromptMarker.IdentityStart,
          ZhiyuanIdentityPrompt,
          CoworkManagedPromptMarker.IdentityEnd,
        ),
    managedBlock(
      CoworkManagedPromptMarker.ScheduledTasksStart,
      buildScheduledTaskEnginePrompt(),
      CoworkManagedPromptMarker.ScheduledTasksEnd,
    ),
    normalizedBasePrompt,
    expertPrompt
      ? managedBlock(
          CoworkManagedPromptMarker.ExpertsStart,
          expertPrompt,
          CoworkManagedPromptMarker.ExpertsEnd,
        )
      : null,
  ].filter((section): section is string => Boolean(section));

  return applyCoworkLanguagePrompt(sections.join('\n\n'), language);
};
