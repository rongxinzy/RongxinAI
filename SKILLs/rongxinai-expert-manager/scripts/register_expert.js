#!/usr/bin/env node
/**
 * Expert Register for RongxinAI (pi engine).
 *
 * Validates an expert package and registers its agents into the RongxinAI
 * SQLite database so they appear in the Agent list.
 *
 * Usage:
 *   node register_expert.js <path/to/expert-dir> [--db-path <sqlite.db>] [--session-id <id>]
 *
 * If --db-path is omitted, the script looks for the default RongxinAI SQLite
 * database in the user's app data directory.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { validateExpert } = require('./validate_expert');

const DEFAULT_DB_FILENAME = 'lobsterai.sqlite';

const AGENT_SOURCE_EXPERT_PACKAGE = 'expert-package';
const AGENT_SOURCE_EXPERT_PACKAGE_MEMBER = 'expert-package-member';

function getDefaultDbPath() {
  const platform = process.platform;
  let base;
  if (platform === 'win32') {
    // Electron's app.getPath('userData') resolves to %APPDATA%\RongxinAI on Windows
    base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  } else if (platform === 'darwin') {
    base = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    base = path.join(os.homedir(), '.config');
  }
  return path.join(base, 'RongxinAI', DEFAULT_DB_FILENAME);
}

function getDefaultExpertPackagesDir() {
  const platform = process.platform;
  let base;
  if (platform === 'win32') {
    base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  } else if (platform === 'darwin') {
    base = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    base = path.join(os.homedir(), '.config');
  }
  return path.join(base, 'RongxinAI', 'expert-packages');
}

function parseMdFrontmatter(mdPath) {
  const content = fs.readFileSync(mdPath, 'utf-8').replace(/\r\n?/g, '\n');
  const match = content.match(/^---\n(.*?)\n---/s);
  if (!match) return { frontmatter: {}, body: content };

  const fmText = match[1];
  const frontmatter = {};
  for (const line of fmText.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.includes(':') && !trimmed.startsWith('-') && !trimmed.startsWith('#')) {
      const [key, ...rest] = trimmed.split(':');
      const value = rest.join(':').trim().replace(/^["']|["']$/g, '');
      if (value) frontmatter[key.trim()] = value;
    }
  }

  const body = content.replace(/^---.*?---/s, '').trim();
  return { frontmatter, body };
}

function normalizeAgentId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || `expert-${Date.now()}`;
}

function generateUuid() {
  // Simple UUID v4 without external deps
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function loadBetterSqlite3() {
  try {
    // When running inside RongxinAI source tree, prefer project's better-sqlite3
    return require('better-sqlite3');
  } catch (e) {
    throw new Error('better-sqlite3 is not available. Make sure to run this script from the RongxinAI project directory.');
  }
}

function ensureAgentsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      identity TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      working_directory TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      skill_ids TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      pinned INTEGER NOT NULL DEFAULT 0,
      pin_order INTEGER,
      is_default INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'custom',
      preset_id TEXT NOT NULL DEFAULT '',
      triage_override TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

function agentIdExists(db, id) {
  const row = db.prepare('SELECT 1 FROM agents WHERE id = ?').get(id);
  return !!row;
}

function agentNameExists(db, name) {
  const row = db.prepare('SELECT 1 FROM agents WHERE LOWER(name) = LOWER(?) AND is_default = 0').get(name.trim());
  return !!row;
}

function makeUniqueAgentId(db, baseId) {
  if (!agentIdExists(db, baseId)) return baseId;
  return `${baseId}-${Date.now()}`;
}

function getDefaultIcon() {
  // Matches encodeAgentAvatarIcon({ svg: AgentAvatarSvg.Lobster })
  return 'agent-avatar-svg:lobster';
}

function pickIconByCategory(categoryId) {
  // Heuristic mapping from category to SVG avatar; falls back to lobster.
  const mapping = {
    '01-ProductDesign': 'artboard',
    '02-Engineering': 'code',
    '03-GameSpatial': 'entertainment',
    '04-DataAI': 'data',
    '05-MarketingGrowth': 'lightning',
    '06-ContentCreative': 'creation',
    '07-SalesCommerce': 'shopping-cart',
    '08-FinanceInvestment': 'scales',
    '09-OperationsHR': 'briefcase',
    '10-ProjectQuality': 'diagnosis',
    '11-SecurityCompliance': 'scales',
    '12-IndustryConsultant': 'books',
  };
  const svg = mapping[categoryId] || 'lobster';
  return `agent-avatar-svg:${svg}`;
}

function resolvePackagePath(expertDir, packagePath, kind) {
  if (typeof packagePath !== 'string' || !packagePath.trim() || path.isAbsolute(packagePath)) {
    throw new Error(`Invalid ${kind} path in expert package: ${String(packagePath)}`);
  }
  const packageRoot = fs.realpathSync(expertDir);
  const candidate = path.resolve(packageRoot, packagePath);
  const resolved = fs.realpathSync(candidate);
  const relative = path.relative(packageRoot, resolved);
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`${kind} path escapes the expert package: ${packagePath}`);
  }
  return resolved;
}

function resolveSkillIds(pluginJson, expertDir) {
  const skillIds = [];
  if (!pluginJson.skills || !Array.isArray(pluginJson.skills)) return skillIds;

  for (const skillPath of pluginJson.skills) {
    const fullPath = resolvePackagePath(expertDir, skillPath, 'skill');
    const skillMdPath = path.join(fullPath, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
      throw new Error(`Skill file not found: ${skillMdPath}`);
    }
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const match = content.match(/^---\n(.*?)\n---/s);
    let skillName = path.basename(fullPath);
    if (match) {
      const nameMatch = match[1].match(/^name:\s*(.+)$/m);
      if (nameMatch) {
        skillName = nameMatch[1].trim();
      }
    }
    skillIds.push(skillName);
  }
  return skillIds;
}

function validatePackagePaths(pluginJson, expertDir) {
  for (const skillPath of pluginJson.skills || []) {
    resolvePackagePath(expertDir, skillPath, 'skill');
  }
  for (const agentPath of pluginJson.agents || []) {
    resolvePackagePath(expertDir, agentPath, 'agent');
  }
  if (pluginJson.expertType === 'team' && pluginJson.teamInfo) {
    for (const memberId of pluginJson.teamInfo.memberAgents || []) {
      resolvePackagePath(expertDir, path.join('agents', `${memberId}.md`), 'member agent');
    }
    resolvePackagePath(
      expertDir,
      path.join('agents', `${pluginJson.teamInfo.leadAgent}.md`),
      'lead agent',
    );
  }
}

function copySkillsToUserData(pluginJson, expertDir, userDataSkillsDir) {
  if (!pluginJson.skills || !Array.isArray(pluginJson.skills)) return;
  fs.mkdirSync(userDataSkillsDir, { recursive: true });

  for (const skillPath of pluginJson.skills) {
    const src = resolvePackagePath(expertDir, skillPath, 'skill');
    const skillName = path.basename(src);
    const dest = path.join(userDataSkillsDir, skillName);
    if (fs.existsSync(dest)) continue; // Do not overwrite existing skills
    copyDirRecursive(src, dest);
  }
}

function getPiAgentsDir() {
  // pi-coding-agent's getAgentDir() resolves to ~/.pi/agent.
  // The subagent extension discovers agents from <agentDir>/agents/*.md.
  const homedir = os.homedir();
  const configDir = process.env.PI_CODING_AGENT_DIR || path.join(homedir, '.pi', 'agent');
  return path.join(configDir, 'agents');
}

/**
 * Copy expert package agent markdown files to pi's agents directory
 * so the subagent extension can discover them.
 *
 * Uses `<expert-name>--<agent-id>.md` naming to avoid collisions across
 * expert packages. Replaces previously synced files on re-registration.
 */
function syncAgentsToPiDir(expertDir, pluginJson) {
  const piAgentsDir = getPiAgentsDir();
  const agentsDir = path.join(expertDir, 'agents');

  if (!fs.existsSync(agentsDir)) return [];

  const syncedFiles = [];
  const mdFiles = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));

  fs.mkdirSync(piAgentsDir, { recursive: true });

  for (const mdFile of mdFiles) {
    const srcPath = resolvePackagePath(expertDir, path.join('agents', mdFile), 'agent');
    if (fs.lstatSync(srcPath).isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in expert packages: ${srcPath}`);
    }
    // Prefix with expert package name to avoid collisions
    const destName = `${pluginJson.name}--${mdFile}`;
    const destPath = path.join(piAgentsDir, destName);

    // Remove previously synced file if it exists (re-registration)
    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath);
    }
    fs.copyFileSync(srcPath, destPath);
    syncedFiles.push(destName);
  }

  // Also clean up stale files from previous registrations (different member list)
  if (fs.existsSync(piAgentsDir)) {
    const currentFiles = new Set(syncedFiles);
    for (const existing of fs.readdirSync(piAgentsDir)) {
      if (existing.startsWith(`${pluginJson.name}--`) && !currentFiles.has(existing)) {
        fs.unlinkSync(path.join(piAgentsDir, existing));
      }
    }
  }

  return syncedFiles;
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    const stat = fs.lstatSync(srcPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in expert packages: ${srcPath}`);
    }
    if (stat.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function writeRegistry(expertDir, pluginJson, agentIds, piSyncedFiles) {
  const packagesDir = path.dirname(expertDir);
  const registryPath = path.join(packagesDir, 'registry.json');
  let registry = { packages: [] };
  if (fs.existsSync(registryPath)) {
    try {
      registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      if (!Array.isArray(registry.packages)) registry.packages = [];
    } catch {
      registry = { packages: [] };
    }
  }

  registry.packages = registry.packages.filter(p => p.name !== pluginJson.name);
  registry.packages.push({
    name: pluginJson.name,
    version: pluginJson.version,
    expertType: pluginJson.expertType,
    path: expertDir,
    agentIds,
    piSyncedFiles: piSyncedFiles || [],
    createdAt: new Date().toISOString(),
  });

  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
}

function registerAgentExpert(db, pluginJson, expertDir, options) {
  const agentMdPath = resolvePackagePath(expertDir, pluginJson.agents[0], 'agent');
  const { frontmatter, body } = parseMdFrontmatter(agentMdPath);

  const name = pluginJson.displayName.zh || pluginJson.displayName.en;
  if (agentNameExists(db, name)) {
    throw new Error(`Agent name '${name}' already exists`);
  }

  const agentId = makeUniqueAgentId(db, normalizeAgentId(pluginJson.agentName));
  const now = Date.now();

  db.prepare(`
    INSERT INTO agents (
      id, name, description, system_prompt, identity, model, working_directory,
      icon, skill_ids, enabled, pinned, is_default, source, preset_id,
      triage_override, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 'expert-package', ?, NULL, ?, ?)
  `).run(
    agentId,
    name,
    pluginJson.displayDescription.zh || pluginJson.displayDescription.en || '',
    body,
    pluginJson.profession.zh || pluginJson.profession.en || '',
    options.model || '',
    options.workingDirectory || '',
    pickIconByCategory(pluginJson.categoryId),
    JSON.stringify(options.skillIds || []),
    pluginJson.name,
    now,
    now,
  );

  return [agentId];
}

function registerTeamExpert(db, pluginJson, expertDir, options) {
  const agentsDir = path.join(expertDir, 'agents');
  const leadAgentName = pluginJson.teamInfo.leadAgent;
  const memberAgentNames = pluginJson.teamInfo.memberAgents;
  const memberIds = [];

  // Register members first
  for (const memberId of memberAgentNames) {
    const mdPath = resolvePackagePath(expertDir, path.join('agents', `${memberId}.md`), 'member agent');
    if (!fs.existsSync(mdPath)) {
      throw new Error(`Member agent markdown not found: ${mdPath}`);
    }
    const { frontmatter, body } = parseMdFrontmatter(mdPath);
    const memberDisplay = (pluginJson.members || []).find(m => m.id === memberId);
    const name = memberDisplay?.displayName?.zh || memberDisplay?.displayName?.en || frontmatter.displayName?.zh || frontmatter.displayName?.en || memberId;

    const agentId = makeUniqueAgentId(db, normalizeAgentId(memberId));
    const now = Date.now();

    db.prepare(`
      INSERT INTO agents (
        id, name, description, system_prompt, identity, model, working_directory,
        icon, skill_ids, enabled, pinned, is_default, source, preset_id,
        triage_override, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 'expert-package-member', ?, NULL, ?, ?)
    `).run(
      agentId,
      name,
      '',
      body,
      memberDisplay?.profession?.zh || memberDisplay?.profession?.en || frontmatter.profession?.zh || frontmatter.profession?.en || '',
      options.model || '',
      options.workingDirectory || '',
      pickIconByCategory(pluginJson.categoryId),
      JSON.stringify([]),
      pluginJson.name,
      now,
      now,
    );

    memberIds.push({ agentId, memberId });
  }

  // Register lead
  const leadMdPath = resolvePackagePath(expertDir, path.join('agents', `${leadAgentName}.md`), 'lead agent');
  if (!fs.existsSync(leadMdPath)) {
    throw new Error(`Lead agent markdown not found: ${leadMdPath}`);
  }
  const { frontmatter: leadFm, body: leadBody } = parseMdFrontmatter(leadMdPath);

  const leadName = pluginJson.displayName.zh || pluginJson.displayName.en;
  if (agentNameExists(db, leadName)) {
    throw new Error(`Agent name '${leadName}' already exists`);
  }

  const leadAgentId = makeUniqueAgentId(db, normalizeAgentId(leadAgentName));
  const now = Date.now();

  // Append member roster to lead system prompt for subagent orchestration
  const memberRoster = memberIds.map(({ memberId, agentId }) => {
    const member = (pluginJson.members || []).find(m => m.id === memberId);
    return `- ${memberId} (Agent DB ID: ${agentId}): ${member?.profession?.zh || member?.profession?.en || memberId}`;
  }).join('\n');

  const augmentedSystemPrompt = `${leadBody}\n\n## 已注册成员映射\n\n${memberRoster}\n\n调度成员时，在 subagent 工具的 name 参数中使用成员 ID（如 ${memberAgentNames[0] || 'member-id'}），系统会自动路由到对应 Agent。`;

  db.prepare(`
    INSERT INTO agents (
      id, name, description, system_prompt, identity, model, working_directory,
      icon, skill_ids, enabled, pinned, is_default, source, preset_id,
      triage_override, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 'expert-package', ?, NULL, ?, ?)
  `).run(
    leadAgentId,
    leadName,
    pluginJson.displayDescription.zh || pluginJson.displayDescription.en || '',
    augmentedSystemPrompt,
    pluginJson.profession.zh || pluginJson.profession.en || '',
    options.model || '',
    options.workingDirectory || '',
    pickIconByCategory(pluginJson.categoryId),
    JSON.stringify(options.skillIds || []),
    pluginJson.name,
    now,
    now,
  );

  return [leadAgentId, ...memberIds.map(m => m.agentId)];
}

function parseExpertPackage(expertDir, options = {}) {
  /**
   * Pure function that parses an expert package and returns a list of
   * CreateAgentRequest objects plus metadata. Does NOT touch the database.
   */
  const expertPath = fs.realpathSync(path.resolve(expertDir));

  // Validate
  const validation = validateExpert(expertPath);
  if (!validation.isValid) {
    const summary = validation.summary();
    throw new Error(`Expert package validation failed:\n${summary}`);
  }

  // Load plugin.json
  const pluginJson = JSON.parse(fs.readFileSync(path.join(expertPath, 'plugin.json'), 'utf-8'));

  // Validate every referenced path before copying files or touching Pi config.
  validatePackagePaths(pluginJson, expertPath);

  // Resolve skill IDs
  const skillIds = resolveSkillIds(pluginJson, expertPath);

  // Copy skills to userData/SKILLs
  const userDataDir = path.dirname(options.dbPath || getDefaultDbPath());
  const userDataSkillsDir = path.join(userDataDir, 'SKILLs');
  copySkillsToUserData(pluginJson, expertPath, userDataSkillsDir);

  // Sync agent MDs to pi agents directory for subagent discovery
  // (Team members and single agents alike — any expert agent can be a subagent target)
  const piSyncedFiles = syncAgentsToPiDir(expertPath, pluginJson);

  const icon = pickIconByCategory(pluginJson.categoryId);
  const requests = [];

  if (pluginJson.expertType === 'team') {
    const agentsDir = path.join(expertPath, 'agents');
    const leadAgentName = pluginJson.teamInfo.leadAgent;
    const memberAgentNames = pluginJson.teamInfo.memberAgents;
    const memberRequests = [];

    // Members first
    for (const memberId of memberAgentNames) {
      const mdPath = resolvePackagePath(expertDir, path.join('agents', `${memberId}.md`), 'member agent');
      if (!fs.existsSync(mdPath)) {
        throw new Error(`Member agent markdown not found: ${mdPath}`);
      }
      const { frontmatter, body } = parseMdFrontmatter(mdPath);
      const memberDisplay = (pluginJson.members || []).find(m => m.id === memberId);
      const name = memberDisplay?.displayName?.zh || memberDisplay?.displayName?.en || frontmatter.displayName?.zh || frontmatter.displayName?.en || memberId;
      const identity = memberDisplay?.profession?.zh || memberDisplay?.profession?.en || frontmatter.profession?.zh || frontmatter.profession?.en || '';

      memberRequests.push({
        id: normalizeAgentId(memberId),
        name,
        description: '',
        systemPrompt: body,
        identity,
        model: options.model || '',
        workingDirectory: options.workingDirectory || '',
        icon,
        skillIds: [],
        source: AGENT_SOURCE_EXPERT_PACKAGE_MEMBER,
        presetId: pluginJson.name,
      });
    }

    // Lead with augmented prompt
    const leadMdPath = resolvePackagePath(expertPath, path.join('agents', `${leadAgentName}.md`), 'lead agent');
    if (!fs.existsSync(leadMdPath)) {
      throw new Error(`Lead agent markdown not found: ${leadMdPath}`);
    }
    const { body: leadBody } = parseMdFrontmatter(leadMdPath);

    const memberRoster = memberRequests.map((req) => {
      const member = (pluginJson.members || []).find(m => normalizeAgentId(m.id) === req.id);
      return `- ${req.id}（${member?.profession?.zh || member?.profession?.en || req.id}）`;
    }).join('\n');

    const augmentedSystemPrompt = `${leadBody}\n\n## 已注册成员映射\n\n${memberRoster}\n\n调度成员时，在 subagent 工具的 name 参数中使用成员 ID（如 ${memberAgentNames[0] || 'member-id'}），系统会自动路由到对应 Agent。`;

    requests.push({
      id: normalizeAgentId(leadAgentName),
      name: pluginJson.displayName.zh || pluginJson.displayName.en,
      description: pluginJson.displayDescription.zh || pluginJson.displayDescription.en || '',
      systemPrompt: augmentedSystemPrompt,
      identity: pluginJson.profession.zh || pluginJson.profession.en || '',
      model: options.model || '',
      workingDirectory: options.workingDirectory || '',
      icon,
      skillIds,
      source: AGENT_SOURCE_EXPERT_PACKAGE,
      presetId: pluginJson.name,
    });

    requests.push(...memberRequests);
  } else {
    const agentMdPath = resolvePackagePath(expertPath, pluginJson.agents[0], 'agent');
    const { body } = parseMdFrontmatter(agentMdPath);

    requests.push({
      id: normalizeAgentId(pluginJson.agentName),
      name: pluginJson.displayName.zh || pluginJson.displayName.en,
      description: pluginJson.displayDescription.zh || pluginJson.displayDescription.en || '',
      systemPrompt: body,
      identity: pluginJson.profession.zh || pluginJson.profession.en || '',
      model: options.model || '',
      workingDirectory: options.workingDirectory || '',
      icon,
      skillIds,
      source: AGENT_SOURCE_EXPERT_PACKAGE,
      presetId: pluginJson.name,
    });
  }

  return { pluginJson, requests, piSyncedFiles };
}

function registerExpert(expertDir, options = {}) {
  const expertPath = path.resolve(expertDir);
  const { pluginJson, requests, piSyncedFiles } = parseExpertPackage(expertPath, options);

  // Open database
  const Database = loadBetterSqlite3();
  const dbPath = options.dbPath || getDefaultDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  const agentIds = [];
  try {
    ensureAgentsTable(db);

    for (const request of requests) {
      const name = request.name;
      if (agentNameExists(db, name)) {
        throw new Error(`Agent name '${name}' already exists`);
      }
      const agentId = makeUniqueAgentId(db, request.id);
      const now = Date.now();

      db.prepare(`
        INSERT INTO agents (
          id, name, description, system_prompt, identity, model, working_directory,
          icon, skill_ids, enabled, pinned, is_default, source, preset_id,
          triage_override, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?, NULL, ?, ?)
      `).run(
        agentId,
        request.name,
        request.description,
        request.systemPrompt,
        request.identity,
        request.model,
        request.workingDirectory,
        request.icon,
        JSON.stringify(request.skillIds || []),
        request.source,
        request.presetId,
        now,
        now,
      );
      agentIds.push(agentId);
    }

    writeRegistry(expertPath, pluginJson, agentIds, piSyncedFiles);

    if (options.sessionId) {
      fs.writeFileSync(path.join(expertPath, '.created-by-session'), options.sessionId, 'utf-8');
    }

    console.log(`✅ Registered ${pluginJson.expertType} expert '${pluginJson.name}' with agents:`);
    for (const id of agentIds) {
      console.log(`   • ${id}`);
    }
    if (piSyncedFiles && piSyncedFiles.length > 0) {
      console.log(`   📋 Synced ${piSyncedFiles.length} agent(s) to pi agents directory for subagent discovery`);
    }
    console.log('   Start a Cowork session with the lead agent to use it.');
    return { pluginJson, agentIds };
  } finally {
    db.close();
  }
}

function printUsage() {
  console.log('Usage: node register_expert.js <path/to/expert-dir> [--db-path <sqlite.db>] [--session-id <id>]');
}

function main() {
  if (process.argv.length < 3) {
    printUsage();
    return 1;
  }

  const expertDir = process.argv[2];
  const options = {};

  const dbPathIndex = process.argv.indexOf('--db-path');
  if (dbPathIndex !== -1 && dbPathIndex + 1 < process.argv.length) {
    options.dbPath = path.resolve(process.argv[dbPathIndex + 1]);
  }

  const sessionIdIndex = process.argv.indexOf('--session-id');
  if (sessionIdIndex !== -1 && sessionIdIndex + 1 < process.argv.length) {
    options.sessionId = process.argv[sessionIdIndex + 1];
  }

  try {
    registerExpert(expertDir, options);
    return 0;
  } catch (e) {
    console.error(`❌ Failed to register expert: ${e.message}`);
    return 1;
  }
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  registerExpert,
  parseExpertPackage,
  getDefaultDbPath,
  getDefaultExpertPackagesDir,
  getPiAgentsDir,
  syncAgentsToPiDir,
  AGENT_SOURCE_EXPERT_PACKAGE,
  AGENT_SOURCE_EXPERT_PACKAGE_MEMBER,
};
