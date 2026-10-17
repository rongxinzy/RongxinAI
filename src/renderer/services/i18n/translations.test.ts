import { describe, expect, test } from 'vitest';

import { enTranslations } from './en';
import { enArtifactsUpdates } from './en/artifactsUpdates';
import { enChannels } from './en/channels';
import { enCoding } from './en/coding';
import { enCommon } from './en/common';
import { enCowork } from './en/cowork';
import { enIm } from './en/im';
import { enLocalInferenceCatalog } from './en/localInferenceCatalog';
import { enLocalInferenceService } from './en/localInferenceService';
import { enMarketplace } from './en/marketplace';
import { enMcpSkills } from './en/mcpSkills';
import { enModelProviders } from './en/modelProviders';
import { enScheduledTask } from './en/scheduledTask';
import { enSecurity } from './en/security';
import { enSettings } from './en/settings';
import { enTodoActivity } from './en/todoActivity';
import { enWorkbench } from './en/workbench';
import { translations } from './translations';
import { zhTranslations } from './zh';
import { zhArtifactsUpdates } from './zh/artifactsUpdates';
import { zhChannels } from './zh/channels';
import { zhCoding } from './zh/coding';
import { zhCommon } from './zh/common';
import { zhCowork } from './zh/cowork';
import { zhIm } from './zh/im';
import { zhLocalInferenceCatalog } from './zh/localInferenceCatalog';
import { zhLocalInferenceService } from './zh/localInferenceService';
import { zhMarketplace } from './zh/marketplace';
import { zhMcpSkills } from './zh/mcpSkills';
import { zhModelProviders } from './zh/modelProviders';
import { zhScheduledTask } from './zh/scheduledTask';
import { zhSecurity } from './zh/security';
import { zhSettings } from './zh/settings';
import { zhTodoActivity } from './zh/todoActivity';
import { zhWorkbench } from './zh/workbench';

const zhModules = [
  zhLocalInferenceService,
  zhLocalInferenceCatalog,
  zhCoding,
  zhCowork,
  zhScheduledTask,
  zhIm,
  zhWorkbench,
  zhMcpSkills,
  zhChannels,
  zhMarketplace,
  zhModelProviders,
  zhSecurity,
  zhTodoActivity,
  zhArtifactsUpdates,
  zhSettings,
  zhCommon,
];

const enModules = [
  enLocalInferenceService,
  enLocalInferenceCatalog,
  enCoding,
  enCowork,
  enScheduledTask,
  enIm,
  enWorkbench,
  enMcpSkills,
  enChannels,
  enMarketplace,
  enModelProviders,
  enSecurity,
  enTodoActivity,
  enArtifactsUpdates,
  enSettings,
  enCommon,
];

describe('split translation modules', () => {
  test('every Chinese module entry is present in the merged translations', () => {
    for (const module of zhModules) {
      expect(zhTranslations).toMatchObject(module);
    }
  });

  test('every English module entry is present in the merged translations', () => {
    for (const module of enModules) {
      expect(enTranslations).toMatchObject(module);
    }
  });

  test('merged translations contain no duplicate keys across modules', () => {
    const zhTotal = zhModules.reduce((sum, module) => sum + Object.keys(module).length, 0);
    const enTotal = enModules.reduce((sum, module) => sum + Object.keys(module).length, 0);
    expect(Object.keys(zhTranslations)).toHaveLength(zhTotal);
    expect(Object.keys(enTranslations)).toHaveLength(enTotal);
  });

  test('top-level translations expose the merged language maps', () => {
    expect(translations.zh).toMatchObject(zhTranslations);
    expect(translations.en).toMatchObject(enTranslations);
    expect(translations.zh.save).toBe('保存');
    expect(translations.en.save).toBe('Save');
  });
});
