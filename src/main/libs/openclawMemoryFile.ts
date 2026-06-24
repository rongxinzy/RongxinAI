/**
 * OpenClaw MEMORY.md file-based memory management.
 *
 * Reads and writes the curated long-term memory file that OpenClaw's
 * memory_search / memory_get tools index automatically.
 *
 * The file may contain mixed content (headings, prose, bullet lists).
 * Only top-level bullet lines (`- text`) are treated as memory entries.
 * Non-bullet content (## headings, paragraphs, etc.) is preserved on writes.
 */

import crypto from 'crypto';
import { app } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TAG = '[OpenClaw Memory]';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemorySource {
  /** Short session ID (first 8 hex chars of SHA) or null for manually-added entries. */
  sessionId: string | null;
  /** Who produced the information. */
  role: 'user' | 'assistant' | 'tool' | 'system' | 'im';
  /** ISO date (YYYY-MM-DD) when the memory was created. */
  date: string;
}

export interface OpenClawMemoryEntry {
  /** SHA-1 of the normalised text – stable across reads. */
  id: string;
  /** Raw text without the leading "- ". */
  text: string;
  /** Source provenance metadata (null for legacy entries or manual additions). */
  source: MemorySource | null;
}

export interface OpenClawMemoryStats {
  total: number;
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const DEFAULT_OPENCLAW_WORKSPACE = path.join(os.homedir(), '.openclaw', 'workspace');

/**
 * Return the fixed workspace path for the main agent.
 * All main-agent state files (MEMORY.md, IDENTITY.md, AGENTS.md, etc.) live here,
 * decoupled from the user-visible "working directory" (which is only used as session cwd).
 */
export function getMainAgentWorkspacePath(stateDir: string): string {
  return path.join(stateDir, 'workspace-main');
}

/**
 * Resolve the MEMORY.md path from an agent workspace directory.
 * Falls back to `~/.openclaw/workspace/MEMORY.md` when unset.
 *
 * NOTE: The parameter represents the agent's workspace path (e.g. from
 * `getMainAgentWorkspacePath()`), not the user-visible working directory.
 */
export function resolveMemoryFilePath(workingDirectory: string | undefined): string {
  const dir = (workingDirectory || '').trim();
  return path.join(dir || DEFAULT_OPENCLAW_WORKSPACE, 'MEMORY.md');
}

// ---------------------------------------------------------------------------
// Fingerprinting (matches sqliteStore.ts logic)
// ---------------------------------------------------------------------------

function normalizeForFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fingerprint(text: string): string {
  return crypto.createHash('sha1').update(normalizeForFingerprint(text)).digest('hex');
}

// ---------------------------------------------------------------------------
// Bullet-line detection (single dash only: "- text")
// ---------------------------------------------------------------------------

/** Match a top-level Markdown bullet: exactly one `-` followed by whitespace. */
const BULLET_RE = /^-\s+(.+)$/;

function isBulletLine(line: string): boolean {
  return BULLET_RE.test(line.trim());
}

// ---------------------------------------------------------------------------
// Source provenance (Phase 2.2a)
// ---------------------------------------------------------------------------

/**
 * Inline source comment at the end of a memory bullet line.
 *
 * Format: <!-- source:s=<sessionId_8chars>:r=<role>:t=<YYYY-MM-DD> -->
 *
 * This is a standard Markdown comment that OpenClaw's parsers ignore.
 * Legacy entries without this comment will have `source: null`.
 */
const SOURCE_RE = /<!--\s*source:s=([a-f0-9]{1,8}):r=([a-z]+):t=(\d{4}-\d{2}-\d{2})\s*-->$/;

function parseSourceFromLine(line: string): MemorySource | null {
  const match = line.match(SOURCE_RE);
  if (!match) return null;
  const role = match[2] as MemorySource['role'];
  const validRoles = new Set<string>(['user', 'assistant', 'tool', 'system', 'im']);
  return {
    sessionId: match[1] || null,
    role: validRoles.has(role) ? (role as MemorySource['role']) : 'system',
    date: match[3],
  };
}

function stripSourceComment(line: string): string {
  return line.replace(SOURCE_RE, '').trimEnd();
}

function formatSourceComment(source: MemorySource): string {
  return `<!-- source:s=${source.sessionId || 'manual'}:r=${source.role}:t=${source.date} -->`;
}

function formatMemoryLine(entry: OpenClawMemoryEntry): string {
  const line = `- ${entry.text}`;
  if (entry.source) {
    return `${line} ${formatSourceComment(entry.source)}`;
  }
  return line;
}

// ---------------------------------------------------------------------------
// Parsing & serialisation
// ---------------------------------------------------------------------------

const HEADER = '# User Memories';

/**
 * Parse a MEMORY.md file into entries.
 *
 * Recognises lines starting with `- ` (single dash + space).
 * Code blocks are stripped before parsing to avoid false positives.
 */
export function parseMemoryMd(content: string): OpenClawMemoryEntry[] {
  const stripped = content.replace(/```[\s\S]*?```/g, ' ');
  const lines = stripped.split(/\r?\n/);
  const entries: OpenClawMemoryEntry[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(BULLET_RE);
    if (!match?.[1]) continue;

    // Strip source comment before fingerprinting so metadata changes
    // don't change the entry ID.
    const rawText = match[1];
    const cleanText = stripSourceComment(rawText);
    const text = cleanText.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const source = parseSourceFromLine(trimmed);
    const fp = fingerprint(text);
    if (seen.has(fp)) continue;
    seen.add(fp);
    entries.push({ id: fp, text, source });
  }

  return entries;
}

/**
 * Serialise entries back to MEMORY.md format (standalone, no existing content).
 */
export function serializeMemoryMd(entries: OpenClawMemoryEntry[]): string {
  if (entries.length === 0) return `${HEADER}\n`;
  const lines = entries.map((e) => formatMemoryLine(e));
  return `${HEADER}\n\n${lines.join('\n')}\n`;
}

/**
 * Build updated MEMORY.md content by surgically applying a diff between
 * the original bullet entries and the desired entries, while preserving
 * all non-bullet content and the overall document structure.
 *
 * Strategy:
 *   1. Build a map from old fingerprint → new text for modified entries.
 *   2. Build a set of fingerprints that should be removed.
 *   3. Walk original lines:
 *      - Non-bullet lines → keep verbatim (headings, prose, blank lines).
 *      - Bullet lines whose fingerprint is in the removal set → skip.
 *      - Bullet lines whose fingerprint is in the update map → replace in-place.
 *      - Bullet lines not in the new entry set → skip (deleted).
 *      - Other bullet lines → keep as-is.
 *   4. Append genuinely new entries (not present in original) at the end.
 */
function rebuildMemoryMd(
  originalContent: string,
  entries: OpenClawMemoryEntry[],
): string {
  if (!originalContent.trim()) {
    return serializeMemoryMd(entries);
  }

  // Build lookup structures for the desired state
  const desiredById = new Map<string, string>();
  for (const e of entries) {
    desiredById.set(e.id, e.text);
  }

  // Parse original bullets to know what existed before
  const originalEntries = parseMemoryMd(originalContent);
  const originalIds = new Set(originalEntries.map((e) => e.id));

  // Identify new entries (not in original) to append later
  const newEntries: OpenClawMemoryEntry[] = [];
  for (const e of entries) {
    if (!originalIds.has(e.id)) {
      newEntries.push(e);
    }
  }

  const lines = originalContent.split(/\r?\n/);
  const result: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    // Toggle fenced-code-block state (never treat bullets inside as entries)
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }
    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    if (isBulletLine(line)) {
      const match = line.trim().match(BULLET_RE);
      if (match?.[1]) {
        const text = match[1].replace(/\s+/g, ' ').trim();
        if (text) {
          const fp = fingerprint(text);

          if (desiredById.has(fp)) {
            // Entry still exists (possibly with updated text via id change)
            // Keep it at its original position, preserving source if available
            const desiredText = desiredById.get(fp)!;
            // Look up the full entry to preserve source metadata
            const desiredEntry = entries.find((e) => e.text === desiredText);
            const source = desiredEntry?.source || parseSourceFromLine(line.trim());
            // Preserve original indentation
            const indent = line.match(/^(\s*)/)?.[1] ?? '';
            const formatted = source
              ? `${indent}- ${desiredText} ${formatSourceComment(source)}`
              : `${indent}- ${desiredText}`;
            result.push(formatted.trimEnd());
            desiredById.delete(fp); // mark as handled
            continue;
          }

          // Check if this position's entry was updated (old id removed,
          // but the entry at this position may have been edited).
          // Since we can't map old→new by position for edits, entries
          // not in desiredById are considered deleted → skip this line.
          continue;
        }
      }
      // Malformed bullet → keep as-is
      result.push(line);
      continue;
    }

    result.push(line);
  }

  // Append genuinely new entries at the end
  if (newEntries.length > 0) {
    // Ensure blank line before new entries
    const lastLine = result[result.length - 1];
    if (lastLine !== undefined && lastLine.trim() !== '') {
      result.push('');
    }
    for (const e of newEntries) {
      result.push(formatMemoryLine(e));
    }
  }

  // Also append any remaining entries from desiredById that were not
  // matched to an original bullet (e.g. entries whose text was updated,
  // producing a new id). These are effectively "updated" entries that
  // lost their positional anchor.
  const remaining = entries.filter((e) => {
    return !newEntries.some((ne) => ne.id === e.id) && desiredById.has(e.id);
  });
  if (remaining.length > 0) {
    const lastLine = result[result.length - 1];
    if (lastLine !== undefined && lastLine.trim() !== '') {
      result.push('');
    }
    for (const e of remaining) {
      result.push(formatMemoryLine(e));
    }
  }

  // Ensure trailing newline
  const text = result.join('\n');
  return text.endsWith('\n') ? text : text + '\n';
}

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readFileOrEmpty(filePath: string): string {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch (error) {
    console.warn(`${TAG} Failed to read file ${filePath}:`, error instanceof Error ? error.message : error);
  }
  return '';
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

export function readMemoryEntries(filePath: string): OpenClawMemoryEntry[] {
  const entries = parseMemoryMd(readFileOrEmpty(filePath));
  return entries;
}

export function writeMemoryEntries(filePath: string, entries: OpenClawMemoryEntry[]): void {
  ensureDir(filePath);
  const original = readFileOrEmpty(filePath);
  fs.writeFileSync(filePath, rebuildMemoryMd(original, entries), 'utf8');
  console.log(`${TAG} writeMemoryEntries: wrote ${entries.length} entries to ${filePath}`);
}

export function addMemoryEntry(
  filePath: string,
  text: string,
  source?: MemorySource | null,
): OpenClawMemoryEntry {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) throw new Error('Memory text is required');

  const entries = readMemoryEntries(filePath);
  const entry: OpenClawMemoryEntry = {
    id: fingerprint(trimmed),
    text: trimmed,
    source: source || null,
  };

  if (entries.some((e) => e.id === entry.id)) {
    console.log(`${TAG} addMemoryEntry: duplicate skipped (id=${entry.id.slice(0, 8)}…)`);
    return entry;
  }

  entries.push(entry);
  writeMemoryEntries(filePath, entries);
  const sourceInfo = entry.source
    ? ` [source:s=${entry.source.sessionId}:r=${entry.source.role}:t=${entry.source.date}]`
    : '';
  console.log(`${TAG} addMemoryEntry: added "${trimmed.slice(0, 40)}…" (id=${entry.id.slice(0, 8)}…)${sourceInfo}`);
  return entry;
}

export function updateMemoryEntry(
  filePath: string,
  id: string,
  newText: string,
): OpenClawMemoryEntry | null {
  const trimmed = newText.replace(/\s+/g, ' ').trim();
  if (!trimmed) throw new Error('Memory text is required');

  const entries = readMemoryEntries(filePath);
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) {
    console.warn(`${TAG} updateMemoryEntry: entry not found (id=${id.slice(0, 8)}…)`);
    return null;
  }

  // Note: ID changes because it's content-based (fingerprint of text)
  const updated: OpenClawMemoryEntry = {
    id: fingerprint(trimmed),
    text: trimmed,
    source: entries[idx].source, // preserve source metadata on update
  };
  const oldText = entries[idx].text;
  entries[idx] = updated;
  writeMemoryEntries(filePath, entries);
  console.log(`${TAG} updateMemoryEntry: "${oldText.slice(0, 30)}…" → "${trimmed.slice(0, 30)}…"`);
  return updated;
}

export function deleteMemoryEntry(filePath: string, id: string): boolean {
  const entries = readMemoryEntries(filePath);
  const target = entries.find((e) => e.id === id);
  const filtered = entries.filter((e) => e.id !== id);
  if (filtered.length === entries.length) {
    console.warn(`${TAG} deleteMemoryEntry: entry not found (id=${id.slice(0, 8)}…)`);
    return false;
  }

  writeMemoryEntries(filePath, filtered);
  console.log(`${TAG} deleteMemoryEntry: removed "${target?.text.slice(0, 40)}…" (${entries.length} → ${filtered.length})`);
  return true;
}

export function searchMemoryEntries(
  filePath: string,
  query: string,
): OpenClawMemoryEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return readMemoryEntries(filePath);
  const all = readMemoryEntries(filePath);
  const results = all.filter((e) => e.text.toLowerCase().includes(q));
  console.log(`${TAG} searchMemoryEntries: query="${q}" → ${results.length}/${all.length} matched`);
  return results;
}

// ---------------------------------------------------------------------------
// SQLite → MEMORY.md migration (lazy, one-time)
// ---------------------------------------------------------------------------

export interface MigrationDataSource {
  /** Whether migration was already performed. */
  isMigrationDone(): boolean;
  /** Mark migration as completed. */
  markMigrationDone(): void;
  /** Retrieve active memory texts from SQLite (status != 'deleted'). */
  getActiveMemoryTexts(): string[];
}

/**
 * Migrate old SQLite user_memories to MEMORY.md.
 * Returns the number of entries migrated (0 if already done or nothing to migrate).
 */
export function migrateSqliteToMemoryMd(
  filePath: string,
  source: MigrationDataSource,
): number {
  if (source.isMigrationDone()) return 0;

  console.log(`${TAG} Migration: starting SQLite → MEMORY.md migration (target: ${filePath})`);

  const texts = source.getActiveMemoryTexts();
  if (texts.length === 0) {
    console.log(`${TAG} Migration: no active SQLite memories found, marking done`);
    source.markMigrationDone();
    return 0;
  }

  console.log(`${TAG} Migration: found ${texts.length} active SQLite memories to migrate`);

  try {
    const existing = readMemoryEntries(filePath);
    const existingIds = new Set(existing.map((e) => e.id));
    console.log(`${TAG} Migration: MEMORY.md has ${existing.length} existing entries`);

    let added = 0;
    let skipped = 0;
    for (const raw of texts) {
      const text = raw.replace(/\s+/g, ' ').trim();
      if (!text || text.length < 1) continue;
      const id = fingerprint(text);
      if (existingIds.has(id)) {
        skipped++;
        continue;
      }
      existing.push({ id, text, source: null });
      existingIds.add(id);
      added++;
    }

    if (added > 0) {
      writeMemoryEntries(filePath, existing);
    }

    console.log(`${TAG} Migration: completed — added=${added}, skipped(duplicate)=${skipped}, total=${existing.length}`);
    source.markMigrationDone();
    return added;
  } catch (error) {
    console.error(`${TAG} Migration: FAILED —`, error instanceof Error ? error.message : error);
    // Do NOT mark done so it retries next time
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Bootstrap file management (IDENTITY.md, USER.md, SOUL.md)
// ---------------------------------------------------------------------------

const DEFAULT_IDENTITY_ZH = '你是李知远智能体，英文产品名是 LEO。李知远智能体 / LEO 是北京容芯致远的产品；只有当用户询问产品归属、公司背景或品牌关系时才说明公司信息。李知远智能体和 LEO 是唯一正式产品名，不要翻译、缩写、替换或改写成其他品牌、代号、模型名、运行时名称或预设角色。用户问你是谁时，只回答“我是李知远智能体。”如有帮助，可补充“英文名是 LEO。”不要把 RongxinAI 描述为当前产品身份；如果用户询问 RongxinAI，只说明它是部分技术路径中的历史名称或兼容标识，当前产品身份是李知远智能体 / LEO。不要把 LobsterAI 描述为当前产品身份；如果用户询问 LobsterAI，只说明它是部分技术路径中的历史内部或兼容标识，当前产品身份是李知远智能体 / LEO。不要声称李知远智能体 / LEO 属于、隶属于、来源于或集成自有道、网易有道或有道云笔记。OpenClaw、Ollama 和 Cowork 是底层实现细节，只有在用户询问运行时、本地模型或集成方式时才说明。你可以在应用授权范围内协助处理本地文件、代码、文档、网页搜索、定时任务和办公自动化。';
const DEFAULT_IDENTITY_EN = 'You are LEO. The official Chinese product name is 李知远智能体, and the official English product name is LEO. 李知远智能体 / LEO is a product of 北京容芯致远; mention the company only when the user asks about product ownership, company background, or brand affiliation. Treat 李知远智能体 and LEO as the only official product names. Do not translate, shorten, replace, or paraphrase them into any other brand, codename, model name, runtime name, or preset role. When asked who you are, answer only with the official product identity. In English, say "I am LEO." You may add "My Chinese product name is 李知远智能体." In Chinese, say "我是李知远智能体。" You may add "英文名是 LEO。". Do not present RongxinAI as the current product identity. If asked about RongxinAI, say only that it is a legacy name or compatibility identifier in some technical paths, while the current product identity is 李知远智能体 / LEO. Do not present LobsterAI as the current product identity. If asked about LobsterAI, say only that it is a historical internal or compatibility identifier in some technical paths, while the current product identity is 李知远智能体 / LEO. Do not claim 李知远智能体 / LEO is owned by, affiliated with, derived from, or integrated from Youdao, NetEase Youdao, or Youdao Notes. OpenClaw, Ollama, and Cowork are implementation details; mention them only when the user asks about the runtime, local models, or integration details. You can help with local files, code, documents, web research, scheduled tasks, and productivity automation within the app\'s available permissions.';
const LEGACY_DEFAULT_IDENTITY_ZH = '你的名字是 LobsterAI，一个全场景个人助理 Agent。你 7×24 小时在线，能够自主处理日常生产力任务，包括数据分析、PPT 制作、视频生成、文档撰写、信息搜索、邮件工作流、定时任务等。你和用户共享同一个工作空间，协同完成用户的目标。';
const LEGACY_DEFAULT_IDENTITY_EN = 'Your name is LobsterAI, a full-scenario personal assistant agent. You are available 24/7 and can autonomously handle everyday productivity tasks, including data analysis, PPT creation, video generation, document writing, information search, email workflows, scheduled jobs, and more. You and the user share the same workspace, collaborating to achieve the user\'s goals.';

function looksLikeLegacyIdentity(content: string): boolean {
  return /\bLobsterAI\b/.test(content) && (
    /你的名字是|Your name is|personal assistant agent|全场景个人助理/u.test(content)
  );
}

function getDefaultIdentity(): string {
  try {
    const locale = app.getLocale();
    return locale.startsWith('zh') ? DEFAULT_IDENTITY_ZH : DEFAULT_IDENTITY_EN;
  } catch {
    return DEFAULT_IDENTITY_EN;
  }
}

const BOOTSTRAP_ALLOWLIST = new Set(['IDENTITY.md', 'USER.md', 'SOUL.md']);

function validateBootstrapFilename(filename: string): void {
  if (!BOOTSTRAP_ALLOWLIST.has(filename)) {
    throw new Error(`Invalid bootstrap filename: ${filename}. Allowed: ${[...BOOTSTRAP_ALLOWLIST].join(', ')}`);
  }
}

/**
 * Resolve the path to a bootstrap file in the agent workspace directory.
 *
 * NOTE: The parameter represents the agent's workspace path (e.g. from
 * `getMainAgentWorkspacePath()`), not the user-visible working directory.
 */
export function resolveBootstrapFilePath(workingDirectory: string | undefined, filename: string): string {
  validateBootstrapFilename(filename);
  const dir = (workingDirectory || '').trim();
  return path.join(dir || DEFAULT_OPENCLAW_WORKSPACE, filename);
}

/**
 * Read a bootstrap file's content. Returns empty string if file doesn't exist.
 */
export function readBootstrapFile(workingDirectory: string | undefined, filename: string): string {
  const filePath = resolveBootstrapFilePath(workingDirectory, filename);
  return readFileOrEmpty(filePath);
}

/**
 * Write content to a bootstrap file, creating the directory if needed.
 */
export function writeBootstrapFile(workingDirectory: string | undefined, filename: string, content: string): void {
  const filePath = resolveBootstrapFilePath(workingDirectory, filename);
  ensureDir(filePath);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`${TAG} writeBootstrapFile: wrote ${filename} (${content.length} chars) to ${filePath}`);
}

/**
 * Ensure IDENTITY.md exists in the workspace with built-in default content.
 * Only writes if the file doesn't exist or is empty — never overwrites user content.
 */
export function ensureDefaultIdentity(workingDirectory: string | undefined): void {
  const filePath = resolveBootstrapFilePath(workingDirectory, 'IDENTITY.md');
  const existing = readFileOrEmpty(filePath);
  const trimmedExisting = existing.trim();
  if (
    trimmedExisting === LEGACY_DEFAULT_IDENTITY_ZH ||
    trimmedExisting === LEGACY_DEFAULT_IDENTITY_EN ||
    looksLikeLegacyIdentity(trimmedExisting)
  ) {
    const defaultContent = getDefaultIdentity();
    ensureDir(filePath);
    fs.writeFileSync(filePath, defaultContent, 'utf8');
    console.log(`${TAG} ensureDefaultIdentity: migrated default IDENTITY.md at ${filePath}`);
    return;
  }
  if (trimmedExisting) return; // already has user content, don't overwrite
  const defaultContent = getDefaultIdentity();
  ensureDir(filePath);
  fs.writeFileSync(filePath, defaultContent, 'utf8');
  console.log(`${TAG} ensureDefaultIdentity: wrote default IDENTITY.md to ${filePath}`);
}

// ---------------------------------------------------------------------------
// Source provenance helpers
// ---------------------------------------------------------------------------

/**
 * Build a MemorySource from session context.
 *
 * @param sessionId - Full Cowork session ID; we shorten to first 8 hex chars
 * @param role - Who said it (user/assistant/tool/system/im)
 * @param date - Optional ISO date string; defaults to today
 */
export function buildMemorySource(
  sessionId: string | null,
  role: MemorySource['role'],
  date?: string,
): MemorySource {
  const shortId = sessionId
    ? sessionId.replace(/-/g, '').slice(0, 8)
    : null;
  return {
    sessionId: shortId,
    role,
    date: date || new Date().toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Workspace change sync
// ---------------------------------------------------------------------------

/**
 * Sync MEMORY.md when workspace directory changes.
 * Copies entries from old path to new path (merge-dedup, keeps old file as backup).
 *
 * Primarily used by the one-time migration from user working directory to
 * the fixed `{STATE_DIR}/workspace-main/` path.
 */
export function syncMemoryFileOnWorkspaceChange(
  oldWorkingDirectory: string | undefined,
  newWorkingDirectory: string | undefined,
): { synced: boolean; error?: string } {
  const oldPath = resolveMemoryFilePath(oldWorkingDirectory);
  const newPath = resolveMemoryFilePath(newWorkingDirectory);

  if (oldPath === newPath) {
    console.log(`${TAG} Workspace sync: same path, skipping`);
    return { synced: false };
  }

  console.log(`${TAG} Workspace sync: ${oldPath} → ${newPath}`);

  try {
    const oldContent = readFileOrEmpty(oldPath);
    if (!oldContent.trim()) {
      console.log(`${TAG} Workspace sync: old MEMORY.md empty or missing, skipping`);
      return { synced: false };
    }

    const oldEntries = parseMemoryMd(oldContent);
    if (oldEntries.length === 0) {
      console.log(`${TAG} Workspace sync: old MEMORY.md has no entries, skipping`);
      return { synced: false };
    }

    const newEntries = readMemoryEntries(newPath);
    const newIds = new Set(newEntries.map((e) => e.id));

    let added = 0;
    for (const entry of oldEntries) {
      if (newIds.has(entry.id)) continue;
      // Preserve source metadata from old file
      newEntries.push({ ...entry, source: entry.source || null });
      newIds.add(entry.id);
      added++;
    }

    if (added > 0) {
      writeMemoryEntries(newPath, newEntries);
    }

    // Ensure memory/ directory exists for OpenClaw daily logs
    const memoryDir = path.join(
      (newWorkingDirectory || '').trim() || DEFAULT_OPENCLAW_WORKSPACE,
      'memory',
    );
    if (!fs.existsSync(memoryDir)) {
      console.log(`${TAG} Workspace sync: creating memory/ dir at ${memoryDir}`);
      fs.mkdirSync(memoryDir, { recursive: true });
    }

    console.log(`${TAG} Workspace sync: done — copied ${added} new entries (old=${oldEntries.length}, new total=${newEntries.length})`);
    return { synced: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`${TAG} Workspace sync: FAILED —`, message);
    return { synced: false, error: message };
  }
}
