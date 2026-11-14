import { open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from '../../skills/skillMarkdown';

const MAX_SKILLS_PER_ROOT = 1024;
const MAX_SKILL_METADATA_BYTES = 65_536;

export interface DurableSkill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
}

export interface DurableSkills {
  skills: DurableSkill[];
  diagnostics: unknown[];
}

async function metadata(file: string): Promise<string> {
  const reader = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(MAX_SKILL_METADATA_BYTES);
    const { bytesRead } = await reader.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await reader.close();
  }
}

/** Bounded, asynchronous discovery from explicitly supplied application roots only. */
export async function loadDurableSkills(
  roots: readonly string[],
  selectedIds?: readonly string[],
): Promise<DurableSkills> {
  if (selectedIds?.length === 0) return { skills: [], diagnostics: [] };
  const skills: DurableSkill[] = [];
  const diagnostics: unknown[] = [];
  const seen = new Set<string>();
  const selected = selectedIds === undefined ? null : new Set(selectedIds);
  for (const root of [...new Set(roots)]) {
    let canonicalRoot: string;
    try {
      canonicalRoot = await realpath(root);
    } catch {
      continue;
    }
    const direct = path.join(canonicalRoot, 'SKILL.md');
    const candidates = await stat(direct)
      .then(() => [canonicalRoot])
      .catch(async () => {
        const entries = await readdir(canonicalRoot, { withFileTypes: true });
        if (entries.length > MAX_SKILLS_PER_ROOT)
          diagnostics.push({ root, message: 'Skill root exceeds the discovery limit.' });
        return entries
          .slice(0, MAX_SKILLS_PER_ROOT)
          .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
          .map(entry => path.join(canonicalRoot, entry.name));
      });
    for (const candidate of candidates) {
      try {
        const baseDir = await realpath(candidate);
        const relative = path.relative(canonicalRoot, baseDir);
        if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
        const id = path.basename(baseDir);
        const filePath = await realpath(path.join(baseDir, 'SKILL.md'));
        const skillRelative = path.relative(baseDir, filePath);
        if (skillRelative.startsWith('..') || path.isAbsolute(skillRelative)) continue;
        const { frontmatter } = parseFrontmatter(await metadata(filePath));
        const name = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : id;
        if (!name || seen.has(name)) continue;
        if (selected && !selected.has(id) && !selected.has(name)) continue;
        if (frontmatter['disable-model-invocation'] === true) continue;
        const description =
          typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '';
        skills.push({ name, description, filePath, baseDir });
        seen.add(name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          diagnostics.push({ path: candidate, message: String(error) });
      }
    }
  }
  return { skills, diagnostics };
}

const xml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function formatDurableSkills(skills: readonly DurableSkill[]): string | undefined {
  if (!skills.length) return undefined;
  return [
    'Read the relevant SKILL.md before using a skill. Resolve its relative paths from its base directory.',
    ...skills.map(
      skill =>
        `<skill><name>${xml(skill.name)}</name><description>${xml(skill.description)}</description><location>${xml(skill.filePath)}</location></skill>`,
    ),
  ].join('\n');
}
