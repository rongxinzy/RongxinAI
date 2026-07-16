#!/usr/bin/env node
/**
 * Expert Validator for RongxinAI (pi engine).
 *
 * Validates an expert package against the RongxinAI expert specification.
 *
 * Usage:
 *   node validate_expert.js <path/to/expert-dir>
 */

const fs = require('fs');
const path = require('path');

const VALID_CATEGORY_IDS = new Set([
  '01-ProductDesign', '02-Engineering', '03-GameSpatial', '04-DataAI',
  '05-MarketingGrowth', '06-ContentCreative', '07-SalesCommerce',
  '08-FinanceInvestment', '09-OperationsHR', '10-ProjectQuality',
  '11-SecurityCompliance', '12-IndustryConsultant',
]);

const VALID_EXPERT_TYPES = new Set(['agent', 'team']);

class ValidationResult {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  error(msg) {
    this.errors.push(msg);
  }

  warn(msg) {
    this.warnings.push(msg);
  }

  get isValid() {
    return this.errors.length === 0;
  }

  summary() {
    const lines = [];
    if (this.errors.length > 0) {
      lines.push(`❌ ${this.errors.length} error(s):`);
      for (const e of this.errors) lines.push(`   • ${e}`);
    }
    if (this.warnings.length > 0) {
      lines.push(`⚠️  ${this.warnings.length} warning(s):`);
      for (const w of this.warnings) lines.push(`   • ${w}`);
    }
    if (this.isValid) lines.push('✅ Expert package is valid!');
    return lines.join('\n');
  }
}

function hasTodo(value) {
  if (value === null || value === undefined) return false;
  return String(value).includes('[TODO');
}

function checkI18nField(obj, fieldName, result, context = 'plugin.json') {
  if (!(fieldName in obj)) {
    result.error(`${context}: missing '${fieldName}'`);
    return false;
  }
  const val = obj[fieldName];
  if (typeof val !== 'object' || val === null || Array.isArray(val)) {
    result.error(`${context}: '${fieldName}' must be an object with 'en' and 'zh'`);
    return false;
  }
  let ok = true;
  for (const lang of ['en', 'zh']) {
    const text = val[lang];
    if (!text || hasTodo(text)) {
      result.error(`${context}: '${fieldName}.${lang}' is empty or contains [TODO]`);
      ok = false;
    }
  }
  return ok;
}

function checkI18nArrayField(obj, fieldName, result, expectedCount) {
  if (!(fieldName in obj)) {
    result.error(`plugin.json: missing '${fieldName}'`);
    return false;
  }
  const arr = obj[fieldName];
  if (!Array.isArray(arr)) {
    result.error(`plugin.json: '${fieldName}' must be an array`);
    return false;
  }
  if (expectedCount !== undefined && arr.length !== expectedCount) {
    result.error(`plugin.json: '${fieldName}' must have exactly ${expectedCount} items, got ${arr.length}`);
  }
  for (let i = 0; i < arr.length; i += 1) {
    const item = arr[i];
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      result.error(`plugin.json: '${fieldName}[${i}]' must be an object`);
      continue;
    }
    for (const lang of ['en', 'zh']) {
      const text = item[lang];
      if (!text || hasTodo(text)) {
        result.error(`plugin.json: '${fieldName}[${i}].${lang}' is empty or contains [TODO]`);
      }
    }
  }
  return true;
}

function parseMdFrontmatter(mdPath) {
  let content;
  try {
    content = fs.readFileSync(mdPath, 'utf-8');
  } catch (e) {
    return { fm: null, content: null, error: `Cannot read ${mdPath}: ${e.message}` };
  }

  if (!content.startsWith('---')) {
    return { fm: null, content, error: `${path.basename(mdPath)}: No YAML frontmatter found` };
  }

  const match = content.match(/^---\n(.*?)\n---/s);
  if (!match) {
    return { fm: null, content, error: `${path.basename(mdPath)}: Invalid frontmatter format` };
  }

  const fmText = match[1];
  const fm = {};
  for (const line of fmText.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.includes(':') && !trimmed.startsWith('-') && !trimmed.startsWith('#')) {
      const [key, ...rest] = trimmed.split(':');
      const value = rest.join(':').trim().replace(/^["']|["']$/g, '');
      if (value) fm[key.trim()] = value;
    }
  }

  return { fm, content, error: null };
}

function validatePluginJson(pluginJson, expertDir, result) {
  for (const field of ['name', 'version', 'description']) {
    if (!pluginJson[field] || hasTodo(pluginJson[field])) {
      result.error(`plugin.json: missing or incomplete required field '${field}'`);
    }
  }

  const name = pluginJson.name || '';
  if (name && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name)) {
    result.error(`plugin.json: 'name' must be kebab-case, got '${name}'`);
  }

  const expertType = pluginJson.expertType;
  if (!VALID_EXPERT_TYPES.has(expertType)) {
    result.error(`plugin.json: 'expertType' must be one of ${[...VALID_EXPERT_TYPES].join(', ')}, got '${expertType}'`);
  }

  const agentName = pluginJson.agentName || '';
  if (!agentName || hasTodo(agentName)) {
    result.error("plugin.json: 'agentName' is missing or contains [TODO]");
  }

  checkI18nField(pluginJson, 'displayName', result);
  checkI18nField(pluginJson, 'profession', result);
  checkI18nField(pluginJson, 'displayDescription', result);
  checkI18nField(pluginJson, 'defaultInitPrompt', result);

  const categoryId = pluginJson.categoryId;
  if (!VALID_CATEGORY_IDS.has(categoryId)) {
    result.error(`plugin.json: 'categoryId' must be one of ${[...VALID_CATEGORY_IDS].sort().join(', ')}, got '${categoryId}'`);
  }

  checkI18nArrayField(pluginJson, 'tags', result, 3);
  checkI18nArrayField(pluginJson, 'quickPrompts', result, 3);

  const quickPrompts = pluginJson.quickPrompts || [];
  const defaultInitPrompt = pluginJson.defaultInitPrompt || {};
  if (quickPrompts.length > 0 && typeof quickPrompts[0] === 'object') {
    for (const lang of ['en', 'zh']) {
      if (quickPrompts[0][lang] !== defaultInitPrompt[lang]) {
        result.warn(`plugin.json: 'quickPrompts[0].${lang}' should match 'defaultInitPrompt.${lang}'`);
      }
    }
  }

  if (pluginJson.plugin !== name) {
    result.error("plugin.json: 'plugin' must equal 'name'");
  }

  const agents = pluginJson.agents;
  if (!Array.isArray(agents) || agents.length === 0) {
    result.error("plugin.json: 'agents' must be a non-empty array");
  } else {
    for (let i = 0; i < agents.length; i += 1) {
      const expectedPath = path.join(expertDir, agents[i]);
      if (!fs.existsSync(expectedPath)) {
        result.error(`plugin.json: agents[${i}] file not found: ${expectedPath}`);
      }
    }
  }

  if (expertType === 'team') {
    const teamInfo = pluginJson.teamInfo;
    if (typeof teamInfo !== 'object' || teamInfo === null || Array.isArray(teamInfo)) {
      result.error("plugin.json: 'teamInfo' is required for team expert");
    } else {
      const lead = teamInfo.leadAgent;
      const members = teamInfo.memberAgents;
      if (!lead || hasTodo(lead)) {
        result.error("plugin.json: 'teamInfo.leadAgent' is missing or incomplete");
      }
      if (!Array.isArray(members) || members.length === 0) {
        result.error("plugin.json: 'teamInfo.memberAgents' must be a non-empty array");
      }
    }

    const membersDisplay = pluginJson.members;
    if (!Array.isArray(membersDisplay)) {
      result.error("plugin.json: 'members' must be an array for team expert");
    } else {
      const leadCount = membersDisplay.filter(m => typeof m === 'object' && m && m.role === 'lead').length;
      if (leadCount !== 1) {
        result.error(`plugin.json: team 'members' must contain exactly one lead, got ${leadCount}`);
      }
    }
  }
}

function validateAgentMd(mdPath, result) {
  const { fm, content, error } = parseMdFrontmatter(mdPath);
  if (error) {
    result.error(error);
    return;
  }
  if (!fm || Object.keys(fm).length === 0) {
    result.error(`${path.basename(mdPath)}: frontmatter is empty`);
    return;
  }

  for (const field of ['name', 'description']) {
    if (!fm[field] || hasTodo(fm[field])) {
      result.error(`${path.basename(mdPath)}: frontmatter '${field}' is missing or incomplete`);
    }
  }

  for (const field of ['displayName', 'profession']) {
    if (!(field in fm)) {
      // Simple parser may not capture nested objects; inspect raw content.
      const sectionMatch = content.match(new RegExp(`^${field}:\\s*$\\n(.*?)(?=^\\w+:|^---|^#)`, 'ms'));
      if (sectionMatch) {
        const section = sectionMatch[1];
        for (const lang of ['en', 'zh']) {
          const langMatch = section.match(new RegExp(`^\\s+${lang}:\\s*"?(.*?)"?$`, 'm'));
          if (!langMatch || hasTodo(langMatch[1])) {
            result.error(`${path.basename(mdPath)}: frontmatter '${field}.${lang}' is missing or contains [TODO]`);
          }
        }
      } else {
        result.error(`${path.basename(mdPath)}: frontmatter '${field}' is missing or contains [TODO]`);
      }
    }
  }

  const body = content.replace(/^---.*?---/s, '');
  const todoCount = (body.match(/\[TODO/g) || []).length;
  if (todoCount > 5) {
    result.warn(`${path.basename(mdPath)}: body still contains many [TODO] placeholders (${todoCount})`);
  }
}

function validateExpert(expertPath) {
  const result = new ValidationResult();

  if (!fs.existsSync(expertPath)) {
    result.error(`Expert directory not found: ${expertPath}`);
    return result;
  }

  const stat = fs.statSync(expertPath);
  if (!stat.isDirectory()) {
    result.error(`Path is not a directory: ${expertPath}`);
    return result;
  }

  const pluginJsonPath = path.join(expertPath, 'plugin.json');
  if (!fs.existsSync(pluginJsonPath)) {
    result.error('Missing plugin.json');
    return result;
  }

  let pluginJson;
  try {
    pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf-8'));
  } catch (e) {
    result.error(`plugin.json is not valid JSON: ${e.message}`);
    return result;
  }

  validatePluginJson(pluginJson, expertPath, result);

  const agentsDir = path.join(expertPath, 'agents');
  if (!fs.existsSync(agentsDir)) {
    result.error('Missing agents/ directory');
  } else {
    const mdFiles = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md')).map(f => path.join(agentsDir, f));
    if (mdFiles.length === 0) {
      result.error('No .md files found in agents/ directory');
    } else {
      for (const mdFile of mdFiles) {
        validateAgentMd(mdFile, result);
      }
    }
  }

  return result;
}

function main() {
  if (process.argv.length < 3) {
    console.log('Usage: node validate_expert.js <path/to/expert-dir>');
    return 1;
  }

  const expertPath = path.resolve(process.argv[2]);
  const result = validateExpert(expertPath);
  console.log(result.summary());
  return result.isValid ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { validateExpert, ValidationResult };
