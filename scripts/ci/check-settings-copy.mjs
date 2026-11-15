#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseSync } from 'oxc-parser';

const ROOT = path.resolve(import.meta.dirname, '../..');

const TARGET_FILES = [
  'src/renderer/services/magpieTranslations.zh.ts',
  'src/renderer/services/magpieTranslations.en.ts',
  'src/renderer/services/magpieProviderTranslations.ts',
  'src/renderer/services/modelBrowseTranslations.ts',
  'src/renderer/services/i18n/zh/settings.ts',
  'src/renderer/services/i18n/en/settings.ts',
  'src/renderer/services/i18n/zh/modelProviders.ts',
  'src/renderer/services/i18n/en/modelProviders.ts',
];

const EXEMPT_KEY_PREFIXES = [
  'magpieExternal',
  'codingAgent',
  'magpieManager',
  'magpieActivation',
  'magpieApplyNotice',
  'magpieNotLoaded',
  'magpieDiscoveryPending',
  'magpieNoAgents',
  'magpieCliMissing',
  'magpieAgentDetected',
  'magpieVersionUnknown',
  'magpieConfigured',
  'magpieNoModelField',
  'magpieEnable',
  'magpieCheckStatus',
  'magpieRefreshManagement',
  'magpieStop',
  'magpieApplyModel',
  'magpieSelectModel',
];

const FORBIDDEN_PATTERNS = [
  { name: '渠道', regex: /渠道/ },
  { name: '网关 / gateway', regex: /网关|\bgateway\b/i },
  { name: '上游 / upstream', regex: /上游|\bupstream\b/i },
  { name: 'FB', regex: /\bFB\b/ },
  { name: '裸模型 / bare id', regex: /裸模型|\bbare id/i },
  { name: 'CORS', regex: /\bCORS\b/i },
  { name: 'MCP', regex: /\bMCP\b/ },
  { name: 'AISphere', regex: /aisphere/i },
  { name: 'Magpie / 喜鹊', regex: /magpie|喜鹊|yetone/i },
  { name: 'cc-connect / llama.cpp', regex: /cc-connect|llama\.cpp/i },
];

function isExemptKey(key) {
  return EXEMPT_KEY_PREFIXES.some(prefix => key.startsWith(prefix));
}

function getPropertyKeyName(prop) {
  if (!prop.key) return '';
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'Literal' || prop.key.type === 'StringLiteral')
    return String(prop.key.value);
  return '';
}

function getStringValue(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'StringLiteral') return node.value;
  return null;
}

function walkObjectProperties(node, violations, file, text) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'ObjectProperty' || node.type === 'Property') {
    const key = getPropertyKeyName(node);
    const val = getStringValue(node.value);
    if (key && val !== null && !isExemptKey(key)) {
      for (const rule of FORBIDDEN_PATTERNS) {
        if (rule.regex.test(val)) {
          const line = text.slice(0, node.start ?? 0).split('\n').length;
          violations.push(`${file}:${line} [${key}] matched forbidden term "${rule.name}": ${val}`);
        }
      }
    }
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) walkObjectProperties(child, violations, file, text);
    } else if (value && typeof value === 'object') {
      walkObjectProperties(value, violations, file, text);
    }
  }
}

const violations = [];
for (const relative of TARGET_FILES) {
  const absolute = path.join(ROOT, relative);
  if (!fs.existsSync(absolute)) continue;
  const text = fs.readFileSync(absolute, 'utf8');
  const { program } = parseSync(relative, text, { sourceType: 'module' });
  walkObjectProperties(program, violations, relative, text);
}

if (violations.length > 0) {
  console.error('Forbidden technical jargon found in user-facing settings copy:\n');
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log('check-settings-copy: ok');
