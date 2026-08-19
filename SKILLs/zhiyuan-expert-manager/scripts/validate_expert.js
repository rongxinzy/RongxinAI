#!/usr/bin/env node
/**
 * Expert Validator for ZhiYuan Agent.
 *
 * Validates an expert package against the ZhiYuan Agent expert specification.
 *
 * Usage:
 *   node validate_expert.js <path/to/expert-dir>
 */

const fs = require('fs');
const path = require('path');

const VALID_CATEGORY_IDS = new Set([
  '01-ProductDesign',
  '02-Engineering',
  '03-GameSpatial',
  '04-DataAI',
  '05-MarketingGrowth',
  '06-ContentCreative',
  '07-SalesCommerce',
  '08-FinanceInvestment',
  '09-OperationsHR',
  '10-ProjectQuality',
  '11-SecurityCompliance',
  '12-IndustryConsultant',
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
    result.error(
      `plugin.json: '${fieldName}' must have exactly ${expectedCount} items, got ${arr.length}`,
    );
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
    content = fs.readFileSync(mdPath, 'utf-8').replace(/\r\n?/g, '\n');
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
      const value = rest
        .join(':')
        .trim()
        .replace(/^["']|["']$/g, '');
      if (value) fm[key.trim()] = value;
    }
  }

  return { fm, content, error: null };
}

/**
 * Determine which agent files are primary (own the conversation) and thus
 * require the Skill usage protocol section:
 * - single-agent experts: every agent file (normally exactly one)
 * - team experts: the lead agent file, but only when the team owns skills
 * Team members never own skills themselves and are exempt.
 *
 * Returns a Map<absolute md path, boolean isPrimary>.
 */
function resolvePrimaryAgents(pluginJson, expertDir) {
  const primary = new Map();
  const agents = Array.isArray(pluginJson.agents) ? pluginJson.agents : [];
  if (pluginJson.expertType === 'team') {
    const leadAgent = pluginJson.teamInfo?.leadAgent;
    const ownsSkills =
      (Array.isArray(pluginJson.skills) && pluginJson.skills.length > 0) ||
      (Array.isArray(pluginJson.skillIds) && pluginJson.skillIds.length > 0);
    if (ownsSkills) {
      for (const agentPath of agents) {
        const agentId = path.basename(agentPath).replace(/\.md$/, '');
        if (agentId === leadAgent) {
          primary.set(path.resolve(expertDir, agentPath), true);
        }
      }
    }
    return primary;
  }
  for (const agentPath of agents) {
    primary.set(path.resolve(expertDir, agentPath), true);
  }
  return primary;
}

/** Semantic keywords the Skill usage protocol section must contain. */
const SKILL_PROTOCOL_SEMANTICS = [
  { label: '从 <available_skills> 中选择', pattern: /<available_skills>/ },
  { label: '使用 read 读取 <location>', pattern: /<location>/ },
  { label: '严格按 SKILL.md 执行', pattern: /SKILL\.md/ },
  { label: '禁止一次性加载全部技能', pattern: /禁止一次性加载|一次只加载/ },
  { label: '按依赖顺序加载后续技能', pattern: /依赖顺序/ },
];

/** Extract the body of a `## <keyword>` section (until the next ## heading). */
function extractSection(body, headingKeyword) {
  const lines = body.split('\n');
  const result = [];
  let inside = false;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      if (heading[1].includes(headingKeyword)) {
        inside = true;
        continue;
      }
      if (inside) break;
      continue;
    }
    if (inside) result.push(line);
  }
  return result.join('\n');
}

/**
 * Headings (##-level) under which checkbox lines appear. Only headings that
 * denote progress ownership count: 进度/SOP (zh) and Progress/Status (en).
 * Plain "清单" headings (交付清单/质量检查清单/上线检查清单) are delivery
 * checklists — output content, not a second task state machine — and stay
 * allowed.
 */
function findChecklistSections(body) {
  const lines = body.split('\n');
  const offenders = [];
  let currentHeading = '';
  for (const line of lines) {
    const heading = line.match(/^##{1,3}\s+(.+)$/);
    if (heading) {
      currentHeading = heading[1].trim();
      continue;
    }
    if (/^\s*-\s+\[[ xX]\]\s+/.test(line) && /进度|SOP|Progress|Status/i.test(currentHeading)) {
      if (!offenders.includes(currentHeading)) offenders.push(currentHeading);
    }
  }
  return offenders;
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
    result.error(
      `plugin.json: 'expertType' must be one of ${[...VALID_EXPERT_TYPES].join(', ')}, got '${expertType}'`,
    );
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
    result.error(
      `plugin.json: 'categoryId' must be one of ${[...VALID_CATEGORY_IDS].sort().join(', ')}, got '${categoryId}'`,
    );
  }

  checkI18nArrayField(pluginJson, 'tags', result, 3);
  checkI18nArrayField(pluginJson, 'quickPrompts', result, 3);

  const quickPrompts = pluginJson.quickPrompts || [];
  const defaultInitPrompt = pluginJson.defaultInitPrompt || {};
  if (quickPrompts.length > 0 && typeof quickPrompts[0] === 'object') {
    for (const lang of ['en', 'zh']) {
      if (quickPrompts[0][lang] !== defaultInitPrompt[lang]) {
        result.warn(
          `plugin.json: 'quickPrompts[0].${lang}' should match 'defaultInitPrompt.${lang}'`,
        );
      }
    }
  }

  const displayDescriptionZh = pluginJson.displayDescription?.zh;
  if (typeof displayDescriptionZh === 'string' && !hasTodo(displayDescriptionZh)) {
    const length = [...displayDescriptionZh].length;
    if (length < 40 || length > 50) {
      result.error(`plugin.json: 'displayDescription.zh' 长度应为 40-50 字，当前 ${length} 字`);
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

  if (pluginJson.skillIds !== undefined) {
    if (!Array.isArray(pluginJson.skillIds)) {
      result.error("plugin.json: 'skillIds' must be an array when provided");
    } else {
      const invalidSkillIds = pluginJson.skillIds.filter(
        skillId => typeof skillId !== 'string' || skillId.trim().length === 0,
      );
      if (invalidSkillIds.length > 0) {
        result.error("plugin.json: 'skillIds' must contain only non-empty strings");
      }
      if (new Set(pluginJson.skillIds).size !== pluginJson.skillIds.length) {
        result.error("plugin.json: 'skillIds' must not contain duplicates");
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
      const leadCount = membersDisplay.filter(
        m => typeof m === 'object' && m && m.role === 'lead',
      ).length;
      if (leadCount !== 1) {
        result.error(`plugin.json: team 'members' must contain exactly one lead, got ${leadCount}`);
      }
    }
  }
}

function validateWorkbenchAcceptanceOwnership(content, label, result) {
  if (/\bwork_acceptance\b/.test(content)) {
    result.error(`${label}: final user acceptance is Workbench-owned (work_acceptance)`);
  }
}
function validateAgentMd(mdPath, result, options = {}) {
  const { requireSkillProtocol = false, strict = false } = options;
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
      const sectionMatch = content.match(
        new RegExp(`^${field}:\\s*$\\n(.*?)(?=^\\w+:|^---|^#)`, 'ms'),
      );
      if (sectionMatch) {
        const section = sectionMatch[1];
        for (const lang of ['en', 'zh']) {
          const langMatch = section.match(new RegExp(`^\\s+${lang}:\\s*"?(.*?)"?$`, 'm'));
          if (!langMatch || hasTodo(langMatch[1])) {
            result.error(
              `${path.basename(mdPath)}: frontmatter '${field}.${lang}' is missing or contains [TODO]`,
            );
          }
        }
      } else {
        result.error(
          `${path.basename(mdPath)}: frontmatter '${field}' is missing or contains [TODO]`,
        );
      }
    }
  }

  const body = content.replace(/^---.*?---/s, '');
  const basename = path.basename(mdPath);
  const todoCount = (body.match(/\[TODO/g) || []).length;
  if (todoCount > 5) {
    result.warn(`${basename}: body still contains many [TODO] placeholders (${todoCount})`);
  }

  if (requireSkillProtocol) {
    // Only inspect the Skill usage protocol section itself, so stray keyword
    // matches elsewhere in the prompt cannot satisfy the requirement.
    const protocolSection = extractSection(body, 'Skill 使用协议');
    const missingSemantics = SKILL_PROTOCOL_SEMANTICS.filter(
      semantic => !semantic.pattern.test(protocolSection),
    ).map(semantic => semantic.label);
    if (missingSemantics.length > 0) {
      result.error(
        `${basename}: primary agent requires a Skill usage protocol section (## Skill 使用协议) with all five semantics; missing: ${missingSemantics.join('、')}`,
      );
    }
  }

  // Hard architectural gates: progress ownership belongs to the runtime.
  // Only checklists inside progress-ownership headings (进度/SOP/清单) are
  // rejected; checkboxes in delivery templates or domain QA sections are
  // output content, not a second task state machine.
  const progressSections = findChecklistSections(body);
  if (progressSections.length > 0) {
    result.error(
      `${basename}: Markdown progress checklists conflict with runtime-owned production progress (${progressSections.join('、')})`,
    );
  }

  const productionToolNames = [
    'production_loop',
    'commit_plan',
    'update_plan_item',
    'skip_workflow',
  ];
  const referencedProductionTools = productionToolNames.filter(toolName =>
    new RegExp(`\\b${toolName}\\b`).test(body),
  );
  if (referencedProductionTools.length > 0) {
    result.error(
      `${basename}: production workflow tools are runtime-owned (${referencedProductionTools.join(', ')})`,
    );
  }

  validateWorkbenchAcceptanceOwnership(body, basename, result);

  // Formatting: full-width dash is the canonical routing heading separator.
  // Bundled presets must pass strict validation; third-party packages only
  // get a warning so a cosmetic difference never blocks registration.
  // Match any half-width hyphen variant (with or without surrounding spaces).
  if (/CRITICAL\s*-/.test(body)) {
    const message = `${basename}: 工作流路由标题使用半角破折号，应为全角（CRITICAL — 收到请求时首先判断）`;
    if (strict) result.error(message);
    else result.warn(message);
  }
}

/**
 * Validate an expert package directory.
 *
 * @param {string} expertPath absolute path to the expert package
 * @param {{ strict?: boolean }} [options] strict mode upgrades cosmetic
 *   formatting checks to errors; used by CI for bundled presets while
 *   third-party imports keep them as warnings.
 */
function validateExpert(expertPath, options = {}) {
  const strict = options.strict === true;
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
  const primaryAgents = resolvePrimaryAgents(pluginJson, expertPath);

  const agentsDir = path.join(expertPath, 'agents');
  if (!fs.existsSync(agentsDir)) {
    result.error('Missing agents/ directory');
  } else {
    const mdFiles = fs
      .readdirSync(agentsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(agentsDir, f));
    if (mdFiles.length === 0) {
      result.error('No .md files found in agents/ directory');
    } else {
      for (const mdFile of mdFiles) {
        validateAgentMd(mdFile, result, {
          requireSkillProtocol: primaryAgents.get(mdFile) === true,
          strict,
        });
      }
    }
  }

  const skillsDir = path.join(expertPath, 'skills');
  if (fs.existsSync(skillsDir)) {
    const pendingDirectories = [skillsDir];
    while (pendingDirectories.length > 0) {
      const directory = pendingDirectories.pop();
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          pendingDirectories.push(entryPath);
        } else if (entry.isFile() && entry.name === 'SKILL.md') {
          const content = fs.readFileSync(entryPath, 'utf-8');
          validateWorkbenchAcceptanceOwnership(
            content,
            path.relative(expertPath, entryPath),
            result,
          );
        }
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

module.exports = { validateAgentMd, validateExpert, ValidationResult };
