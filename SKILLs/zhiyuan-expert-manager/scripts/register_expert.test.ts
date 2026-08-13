import { createRequire } from 'node:module';
import path from 'node:path';

import { expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { resolveSkillIds } = require('./register_expert.js') as {
  resolveSkillIds: (pluginJson: Record<string, unknown>, expertDir: string) => string[];
};

const presetsDir = path.resolve(import.meta.dirname, '..', 'presets');

const resolvePresetSkillIds = (presetName: string): string[] => {
  const expertDir = path.join(presetsDir, presetName);
  const pluginJson = require(path.join(expertDir, 'plugin.json')) as Record<string, unknown>;
  return resolveSkillIds(pluginJson, expertDir);
};

test('combines shared and packaged skills for business expert presets', () => {
  expect(resolvePresetSkillIds('presales-technical-consultant')).toEqual([
    'web-search',
    'docx',
    'xlsx',
    'pptx',
    'pdf',
    'presales-technical-consulting',
  ]);

  expect(resolvePresetSkillIds('marketing-campaign-expert')).toEqual([
    'web-search',
    'campaign-planner',
    'marketing-writer',
    'ad-creative',
    'docx',
    'xlsx',
    'pptx',
    'pdf',
    'executing-marketing-campaigns',
  ]);

  expect(resolvePresetSkillIds('finance-accounting-expert')).toEqual([
    'web-search',
    'xlsx',
    'docx',
    'pdf',
    'finance-workflows',
    'financial-statements',
    'journal-entry-prep',
    'reconciliation',
    'close-management',
    'audit-support',
    'variance-analysis',
  ]);
});

test('combines shared and packaged skills for skill-based workflow presets', () => {
  expect(resolvePresetSkillIds('data-analyst')).toEqual([
    'xlsx',
    'code-to-chart',
    'database-inspector',
    'saas-metrics-coach',
    'web-search',
    'deep-research',
    'data-quality-review',
    'metric-diagnosis',
    'analytics-report',
  ]);

  expect(resolvePresetSkillIds('react-dev')).toEqual([
    'frontend-design',
    'git-repo-audit',
    'code-safety-audit',
    'code-arch-optimizer',
    'web-security-audit',
    'log-diagnostic',
    'smart-commit-gen',
    'react-component-blueprint',
    'react-troubleshooting',
  ]);

  expect(resolvePresetSkillIds('content-writer')).toEqual([
    'web-search',
    'deep-research',
    'copywriting',
    'copy-editor',
    'ad-copywriter',
    'ad-creative',
    'viral-writer',
    'marketing-writer',
    'campaign-planner',
    'customer-reply-craft',
    'churn-prevention',
    'ecom-copy-assistant',
    'humanizer-zh',
    'content-research-writer',
    'meeting-recap',
    'process-doc',
    'xindaya-translator',
    'content-brief',
  ]);
});
