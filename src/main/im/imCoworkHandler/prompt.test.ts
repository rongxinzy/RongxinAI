import { describe, expect, test } from 'vitest';

import { buildScheduledTaskEnginePrompt } from '../../../scheduledTask/enginePrompt';
import { getBranding } from '../../../shared/branding';
import { buildIMCoworkSystemPrompt } from './prompt';

function createCoworkStore(systemPrompt = '') {
  return {
    config: {
      workingDirectory: process.cwd(),
      systemPrompt,
      executionMode: 'local',
      agentEngine: 'pi',
    },
    getConfig() {
      return this.config;
    },
  };
}

function createIMStore(skillsEnabled = false) {
  return {
    settings: { skillsEnabled },
    getIMSettings() {
      return this.settings;
    },
  };
}

describe('buildIMCoworkSystemPrompt', () => {
  test('assembles identity, config prompt, scheduled task and media sections', async () => {
    const prompt = await buildIMCoworkSystemPrompt({
      coworkStore: createCoworkStore('Use the workspace conversation context.') as never,
      imStore: createIMStore() as never,
    });

    const branding = getBranding();
    expect(prompt).toContain(`You are ${branding.productName} (${branding.englishName}).`);
    expect(prompt).toContain('Use the workspace conversation context.');
    expect(prompt).toContain(buildScheduledTaskEnginePrompt());
    expect(prompt).toContain('<im_media_capabilities>');
    expect(prompt.indexOf('You are')).toBeLessThan(prompt.indexOf('Use the workspace'));
    expect(prompt.indexOf('Use the workspace')).toBeLessThan(
      prompt.indexOf('<im_media_capabilities>'),
    );
  });

  test('omits the config section when no system prompt is configured', async () => {
    const prompt = await buildIMCoworkSystemPrompt({
      coworkStore: createCoworkStore('') as never,
      imStore: createIMStore() as never,
    });
    expect(prompt).not.toContain('Use the workspace');
    // identity first, media instruction last
    expect(prompt.startsWith('You are')).toBe(true);
    expect(prompt.endsWith('</im_media_capabilities>')).toBe(true);
  });

  test('appends the skills prompt only when skills are enabled', async () => {
    const deps = {
      coworkStore: createCoworkStore() as never,
      getSkillsPrompt: async () => '<available_skills>skill-a</available_skills>',
    };

    const disabled = await buildIMCoworkSystemPrompt({
      ...deps,
      imStore: createIMStore(false) as never,
    });
    expect(disabled).not.toContain('<available_skills>');

    const enabled = await buildIMCoworkSystemPrompt({
      ...deps,
      imStore: createIMStore(true) as never,
    });
    expect(enabled).toContain('<available_skills>skill-a</available_skills>');
    expect(enabled.indexOf('<available_skills>')).toBeLessThan(
      enabled.indexOf('<im_media_capabilities>'),
    );
  });
});
