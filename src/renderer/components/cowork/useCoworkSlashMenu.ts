import { useCallback, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { CoworkCompactFailure } from '../../../shared/cowork/constants';
import { showAppToast } from '../../services/appToast';
import { i18nService } from '../../services/i18n';
import { skillService } from '../../services/skill';
import { RootState } from '../../store';
import type { Skill } from '../../types/skill';
import type { SlashCommandMenuItem } from '../common/SlashCommandMenu';
import {
  CoworkSlashCommand,
  buildCoworkSlashCommands,
  coworkSlashCommandArgument,
  coworkSlashCommandPrompt,
  coworkSlashCommandQuery,
  coworkSlashSelectionPrompt,
  filterCoworkSlashCommands,
  filterCoworkSlashOptions,
  type CoworkSlashCommandItem,
} from './coworkSlashCommands';

interface UseCoworkSlashMenuOptions {
  value: string;
  disabled: boolean;
  remoteManaged: boolean;
  sessionId?: string;
  setValue: (value: string) => void;
  focusEditor: () => void;
}

/**
 * Slash command menu state for the Cowork composer (`/skill`, `/compact`).
 * Mirrors the coding composer: completions while typing, and a dismissal that
 * applies to the exact text on screen so the menu does not bounce back open.
 */
export const useCoworkSlashMenu = ({
  value,
  disabled,
  remoteManaged,
  sessionId,
  setValue,
  focusEditor,
}: UseCoworkSlashMenuOptions) => {
  const [commandSelection, setCommandSelection] = useState<{
    query: string | null;
    name: string;
  }>({ query: null, name: '' });
  const [choiceSelection, setChoiceSelection] = useState<{
    argument: string | null;
    value: string;
  }>({ argument: null, value: '' });
  const [dismissedPrompt, setDismissedPrompt] = useState<string | null>(null);

  const skills = useSelector((state: RootState) => state.skill.skills);
  const enabledSkills = useMemo(() => skills.filter(skill => skill.enabled), [skills]);

  const commands = buildCoworkSlashCommands(
    { skills: enabledSkills.length > 0, compact: !!sessionId },
    {
      skillDescription: i18nService.t('coworkSlashCommandSkillDescription'),
      skillHint: i18nService.t('coworkSlashCommandSkillHint'),
      compactDescription: i18nService.t('coworkSlashCommandCompactDescription'),
    },
  );
  const query = coworkSlashCommandQuery(value);
  const matchingCommands = query === null ? [] : filterCoworkSlashCommands(commands, query);
  const argument = coworkSlashCommandArgument(value);
  const skillOptions = enabledSkills.map(skill => ({
    value: skill.id,
    label: skill.displayName || skill.name,
    description:
      (i18nService.getLanguage() === 'zh' && skill.displayDescription) ||
      skillService.getLocalizedSkillDescription(skill.id, skill.name, skill.description),
  }));
  const matchingOptions =
    argument?.name === CoworkSlashCommand.Skill
      ? filterCoworkSlashOptions(skillOptions, argument.query)
      : [];

  const selectedCommandName = commandSelection.query === query ? commandSelection.name : '';
  const selectedCommand =
    matchingCommands.find(command => command.name === selectedCommandName) ?? matchingCommands[0];
  const selectedChoiceValue =
    choiceSelection.argument === (argument?.query ?? null) ? choiceSelection.value : '';
  const selectedChoice =
    matchingOptions.find(option => option.value === selectedChoiceValue) ?? matchingOptions[0];

  const menuDismissed = dismissedPrompt === value;
  // Typing stays available while a session streams (Work queues prompts), so
  // unlike the coding composer the menu only closes for disabled/read-only.
  const choiceMenuOpen =
    !disabled &&
    !remoteManaged &&
    argument !== null &&
    argument.name === CoworkSlashCommand.Skill &&
    skillOptions.length > 0 &&
    !menuDismissed;
  const commandMenuOpen =
    !disabled && !remoteManaged && query !== null && commands.length > 0 && !menuDismissed;
  const open = choiceMenuOpen || commandMenuOpen;

  const items: SlashCommandMenuItem[] = choiceMenuOpen
    ? matchingOptions.map(option => ({
        key: option.value,
        token: option.label,
        ...(option.description ? { description: option.description } : {}),
      }))
    : matchingCommands.map(command => ({
        key: command.name,
        token: `/${command.name}`,
        description: command.description,
        ...(command.hint ? { hint: command.hint } : {}),
      }));
  const activeItemKey = choiceMenuOpen
    ? (selectedChoice?.value ?? '')
    : (selectedCommand?.name ?? '');

  const applyPrompt = (nextPrompt: string, options?: { openChoices?: boolean }) => {
    // A dismissal normally remembers the text the user just accepted, so the
    // menu does not bounce back open. Commands that take a selection are the
    // exception: the menu swaps to their candidates instead of closing.
    setDismissedPrompt(options?.openChoices ? null : nextPrompt);
    setValue(nextPrompt);
    requestAnimationFrame(() => focusEditor());
  };

  const selectCommand = (command: CoworkSlashCommandItem) => {
    applyPrompt(coworkSlashCommandPrompt(command), { openChoices: !!command.hint });
  };

  const selectMenuChoice = (key: string) => {
    if (choiceMenuOpen) {
      applyPrompt(coworkSlashSelectionPrompt(CoworkSlashCommand.Skill, key));
      return;
    }
    const command = matchingCommands.find(candidate => candidate.name === key);
    if (command) selectCommand(command);
  };

  const setMenuSelection = (key: string) => {
    if (choiceMenuOpen) {
      setChoiceSelection({ argument: argument?.query ?? '', value: key });
      return;
    }
    setCommandSelection({ query, name: key });
  };

  /** The inserted form of the highlighted entry, used by Enter-to-submit. */
  const activeSelectionPrompt = choiceMenuOpen
    ? coworkSlashSelectionPrompt(CoworkSlashCommand.Skill, activeItemKey)
    : selectedCommand
      ? coworkSlashCommandPrompt(selectedCommand)
      : null;

  const dismiss = useCallback(() => setDismissedPrompt(value), [value]);
  const clearDismissal = useCallback(() => setDismissedPrompt(null), []);

  const findEnabledSkill = useCallback(
    (skillId: string): Skill | undefined => enabledSkills.find(skill => skill.id === skillId),
    [enabledSkills],
  );

  const runCompact = useCallback(async () => {
    if (!sessionId) return;
    showAppToast(i18nService.t('coworkSlashCompactStarted'));
    try {
      const result = await window.electron.cowork.compactSession(sessionId);
      if (result.success) {
        if (result.queued) {
          showAppToast(i18nService.t('coworkSlashCompactQueued'));
        } else if (result.cancelled) {
          showAppToast(i18nService.t('coworkSlashCompactCancelled'));
        } else {
          showAppToast(i18nService.t('coworkSlashCompactSuccess'), { isSuccess: true });
        }
        return;
      }
      const reasonKeys: Record<CoworkCompactFailure, string> = {
        [CoworkCompactFailure.NoSession]: 'coworkSlashCompactNoSession',
        [CoworkCompactFailure.Busy]: 'coworkSlashCompactBusy',
        [CoworkCompactFailure.NotNeeded]: 'coworkSlashCompactNotNeeded',
        [CoworkCompactFailure.Failed]: 'coworkSlashCompactFailed',
      };
      const reason = result.reason ?? CoworkCompactFailure.Failed;
      showAppToast(i18nService.t(reasonKeys[reason]), {
        isError: reason === CoworkCompactFailure.Failed,
      });
    } catch (error) {
      console.error('[CoworkSlashMenu] compaction request failed:', error);
      showAppToast(i18nService.t('coworkSlashCompactFailed'), { isError: true });
    }
  }, [sessionId]);

  return {
    open,
    items,
    activeItemKey,
    activeSelectionPrompt,
    choiceMenuOpen,
    selectedCommand,
    enabledSkills,
    findEnabledSkill,
    dismiss,
    clearDismissal,
    setMenuSelection,
    selectMenuChoice,
    runCompact,
  };
};
