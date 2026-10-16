import crypto from 'crypto';

import type { CoworkPromptLanguage } from '../coworkLanguagePrompt';
import {
  type CoworkSessionExpertInput,
  type CoworkSessionExpertSnapshot,
  CoworkSessionExpertSource,
  normalizeSingleExpertIds,
} from '../../shared/cowork/sessionExperts';
import { resolveBundledPresetExpertSnapshot } from '../presetExpertSnapshot';
import { getAgentManager, getSkillManager, getStore } from './runtimeServices';
import type { AppConfigSettings } from './appConfigSettings';

export const resolveCoworkPromptLanguage = (): CoworkPromptLanguage => {
  const configuredLanguage = getStore().get<AppConfigSettings>('app_config')?.language;
  return configuredLanguage === 'en' ? 'en' : 'zh';
};

export const haveSameExpertSnapshots = (
  left: CoworkSessionExpertSnapshot[],
  right: CoworkSessionExpertInput[],
): boolean =>
  left.length === right.length &&
  left.every(
    (expert, index) =>
      expert.expertId === right[index]?.expertId &&
      expert.contentHash === right[index]?.contentHash,
  );

export const haveSameExpertIds = (
  experts: CoworkSessionExpertSnapshot[],
  requestedExpertIds: string[],
): boolean => {
  const normalizedIds = normalizeSingleExpertIds(requestedExpertIds);
  return (
    experts.length === normalizedIds.length &&
    experts.every((expert, index) => expert.expertId === normalizedIds[index])
  );
};

export const resolveSessionExpertSnapshots = (expertIds: string[]): CoworkSessionExpertInput[] => {
  const normalizedExpertIds = normalizeSingleExpertIds(expertIds);
  const snapshots: CoworkSessionExpertInput[] = [];
  for (const expertId of normalizedExpertIds) {
    const expert = getAgentManager().getAgent(expertId);
    if (
      !expert ||
      (expert.source !== CoworkSessionExpertSource.Package &&
        expert.source !== CoworkSessionExpertSource.Member)
    ) {
      throw new Error(`Expert '${expertId}' is not installed or is not an expert package agent`);
    }
    let promptSnapshot = expert.systemPrompt.trim();
    const packageId = expert.presetId.trim() || expert.id;
    let skillIds = [...expert.skillIds];

    // Bundled presets are file-sourced like regular skills: the preset
    // markdown is read live on every session so editing the preset takes
    // effect without re-importing. The DB snapshot remains the fallback
    // when the preset directory is missing or unreadable.
    if (expert.presetId.trim()) {
      const bundledSkillsRoot = getSkillManager().getBundledSkillsRoot();
      // The main session loads only the selected agent's file: the lead for
      // teams, the single file for standalone agents.
      const liveSnapshot = resolveBundledPresetExpertSnapshot(
        bundledSkillsRoot,
        packageId,
        expert.id,
      );
      if (liveSnapshot) {
        promptSnapshot = liveSnapshot.promptSnapshot;
        skillIds = liveSnapshot.skillIds;
      }
    }

    if (!promptSnapshot) {
      throw new Error(`Expert '${expertId}' has an empty system prompt`);
    }
    const contentHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ packageId, expertId: expert.id, promptSnapshot, skillIds }))
      .digest('hex');
    snapshots.push({
      expertId: expert.id,
      packageId,
      expertName: expert.name,
      source: expert.source,
      promptSnapshot,
      skillIds,
      capabilityPolicy: {},
      contentHash,
    });
  }
  return snapshots;
};
