/**
 * System prompt assembly for IM cowork sessions.
 */

import { buildScheduledTaskEnginePrompt } from '../../../scheduledTask/enginePrompt';
import { getBranding } from '../../../shared/branding';
import type { CoworkStore } from '../../coworkStore';
import { buildIMMediaInstruction } from '../imMediaInstruction';
import type { IMStore } from '../imStore';

interface IMCoworkPromptDeps {
  coworkStore: CoworkStore;
  imStore: IMStore;
  getSkillsPrompt?: () => Promise<string | null>;
}

export async function buildIMCoworkSystemPrompt(deps: IMCoworkPromptDeps): Promise<string> {
  const config = deps.coworkStore.getConfig();
  const imSettings = deps.imStore.getIMSettings();
  const systemPrompt = config.systemPrompt || '';
  const scheduledTaskPrompt = buildScheduledTaskEnginePrompt();

  // Build media instruction for IM media sending capability
  const mediaInstruction = buildIMMediaInstruction(imSettings);

  const branding = getBranding();
  const identityPrompt =
    branding.editionId === 'zhiyuan'
      ? [
          'You are 知远智能体 (ZhiYuan Agent).',
          'The official Chinese product name is 知远智能体, and the official English product name is ZhiYuan Agent.',
          '知远智能体 (ZhiYuan Agent) is a product of 北京容芯致远. Mention the company only when the user asks about product ownership, company background, or brand affiliation.',
          'Treat 知远智能体 and ZhiYuan Agent as the only official product names. Do not translate, localize, transliterate, shorten, or replace them with any other variant or product identity.',
          'When the user asks who you are, answer with the official product identity only. In Chinese, say "我是知远智能体。" You may add "英文名是 ZhiYuan Agent。". In English, say "I am ZhiYuan Agent." You may add "My Chinese product name is 知远智能体."',
          'Do not use any other product name, model name, runtime name, or preset role as your identity.',
          'The execution runtime and local inference stack are fully self-developed implementation details; mention them only when the user asks about runtime, local-model, or integration details.',
        ].join('\n')
      : [
          `You are ${branding.productName} (${branding.englishName}).`,
          `The official Chinese product name is ${branding.productName}, and the official English product name is ${branding.englishName}.`,
          branding.promptIdentity.instructions,
          `When the user asks who you are, answer with the official product identity only. In Chinese, say "${branding.promptIdentity.chinese}". In English, say "${branding.promptIdentity.english}".`,
          'Do not use any other product name, model name, runtime name, or preset role as your identity.',
        ].join('\n');

  const sections: string[] = [identityPrompt];
  if (systemPrompt) {
    sections.push(systemPrompt);
  }

  if (imSettings.skillsEnabled && deps.getSkillsPrompt) {
    const skillsPrompt = await deps.getSkillsPrompt();
    if (skillsPrompt) {
      sections.push(skillsPrompt);
    }
  }

  if (scheduledTaskPrompt) {
    sections.push(scheduledTaskPrompt);
  }

  // Append media instruction at the end so it's always present
  if (mediaInstruction) {
    sections.push(mediaInstruction);
  }

  return sections.join('\n\n');
}
