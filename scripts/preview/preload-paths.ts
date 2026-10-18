/**
 * Textual walker over preload fragment sources, used by the browser-mock
 * generator's preload ↔ IElectronAPI verification.
 *
 * The walker mirrors object-literal structure (nested objects, computed keys,
 * `...spread` of `createIpcInvokers(<channelMap>)`, and `as <type>` casts)
 * without a full TypeScript parse; channel-map spreads are expanded from the
 * zod-free `*.channels.ts` modules the preload imports.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Strip // and block comments without touching string/template contents. */
function stripTypeScriptComments(source: string): string {
  let out = '';
  let index = 0;
  while (index < source.length) {
    const ch = source[index];
    const next = source[index + 1];
    if (ch === '/' && next === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      index += 1;
      while (index < source.length) {
        const c = source[index];
        out += c;
        index += 1;
        if (c === '\\') {
          if (index < source.length) {
            out += source[index];
            index += 1;
          }
          continue;
        }
        if (quote === '`' && c === '$' && source[index] === '{') {
          out += '{';
          index += 1;
          let depth = 1;
          while (index < source.length && depth > 0) {
            const t = source[index];
            out += t;
            index += 1;
            if (t === '{') depth += 1;
            else if (t === '}') depth -= 1;
          }
          continue;
        }
        if (c === quote) break;
      }
      continue;
    }
    out += ch;
    index += 1;
  }
  return out;
}

function skipWhitespace(source: string, index: number): number {
  while (index < source.length && /\s/.test(source[index] ?? '')) index += 1;
  return index;
}

function readIdentifier(source: string, index: number): { name: string; next: number } | undefined {
  index = skipWhitespace(source, index);
  const start = index;
  if (!/[A-Za-z_$]/.test(source[index] ?? '')) return undefined;
  index += 1;
  while (index < source.length && /[\w$]/.test(source[index] ?? '')) index += 1;
  return { name: source.slice(start, index), next: index };
}

function skipBalanced(source: string, index: number, open: string, close: string): number {
  if (source[index] !== open) return index;
  let depth = 0;
  let i = index;
  while (i < source.length) {
    const ch = source[i];
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < source.length) {
        const c = source[i];
        i += 1;
        if (c === '\\') {
          i += 1;
          continue;
        }
        if (quote === '`' && c === '$' && source[i] === '{') {
          i = skipBalanced(source, i, '{', '}');
          continue;
        }
        if (c === quote) break;
      }
      continue;
    } else if (ch === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    } else if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    i += 1;
  }
  throw new Error(`Unbalanced ${open}${close} in preload fragment`);
}

function skipExpressionValue(source: string, index: number): number {
  index = skipWhitespace(source, index);
  const ch = source[index];
  if (ch === '{') return skipBalanced(source, index, '{', '}');
  if (ch === '(') return skipBalanced(source, index, '(', ')');
  if (ch === '[') return skipBalanced(source, index, '[', ']');
  if (ch === "'" || ch === '"' || ch === '`') {
    const quote = ch;
    index += 1;
    while (index < source.length) {
      const c = source[index];
      index += 1;
      if (c === '\\') {
        index += 1;
        continue;
      }
      if (quote === '`' && c === '$' && source[index] === '{') {
        index = skipBalanced(source, index, '{', '}');
        continue;
      }
      if (c === quote) break;
    }
    return index;
  }
  while (index < source.length) {
    const c = source[index];
    if (c === ',' || c === '}' || c === ')') break;
    if (c === '{' || c === '(' || c === '[') {
      index = skipBalanced(source, index, c, c === '{' ? '}' : c === '(' ? ')' : ']');
      continue;
    }
    index += 1;
  }
  return index;
}

function collectPathsFromObjectLiteralText(
  source: string,
  openBraceIndex: number,
  prefix: string,
  channelMaps?: Map<string, Set<string>>,
): Set<string> {
  const paths = new Set<string>();
  let index = openBraceIndex + 1;
  while (index < source.length) {
    index = skipWhitespace(source, index);
    if (source[index] === '}') break;
    if (source[index] === ',') {
      index += 1;
      continue;
    }
    if (source.slice(index, index + 3) === '...') {
      index = skipWhitespace(source, index + 3);
      const spread = readCreateIpcInvokersCall(source, index);
      if (spread) {
        const methodNames = channelMaps?.get(spread.channelMapIdentifier);
        if (methodNames) {
          for (const name of methodNames) {
            paths.add(prefix ? `${prefix}.${name}` : name);
          }
        }
        index = spread.end;
      } else {
        index = skipExpressionValue(source, index);
      }
      continue;
    }
    if (source[index] === '[') {
      index = skipBalanced(source, index, '[', ']');
      index = skipWhitespace(source, index);
      if (source[index] === ':') index = skipExpressionValue(source, index + 1);
      continue;
    }
    const ident = readIdentifier(source, index);
    if (!ident) {
      index = skipExpressionValue(source, index);
      continue;
    }
    index = ident.next;
    index = skipWhitespace(source, index);
    // `} as <type>` casts close a property object; skip the type expression.
    if (ident.name === 'as') {
      index = skipExpressionValue(source, index);
      continue;
    }
    const pathKey = prefix ? `${prefix}.${ident.name}` : ident.name;
    if (source[index] === '(') {
      paths.add(pathKey);
      index = skipBalanced(source, index, '(', ')');
      continue;
    }
    if (source[index] === ':') {
      index = skipWhitespace(source, index + 1);
      if (source[index] === '{') {
        for (const nested of collectPathsFromObjectLiteralText(
          source,
          index,
          pathKey,
          channelMaps,
        )) {
          paths.add(nested);
        }
        index = skipBalanced(source, index, '{', '}');
      } else {
        paths.add(pathKey);
        index = skipExpressionValue(source, index);
      }
      continue;
    }
    paths.add(pathKey);
    index = skipExpressionValue(source, index);
  }
  return paths;
}

function findExportObjectBrace(source: string, exportName: string): number {
  // Tolerates an optional type annotation (`export const x: T = { ... }`).
  const pattern = new RegExp(`export\\s+const\\s+${exportName}\\s*(:[^=]*?)?\\s*=\\s*\\{`);
  const match = pattern.exec(source);
  if (!match) throw new Error(`Missing export const ${exportName}`);
  return match.index + match[0].length - 1;
}

/**
 * Match `createIpcInvokers(<identifier>)` at `index`; returns the channel-map
 * identifier and the index just past the closing paren, or undefined when the
 * expression is anything else.
 */
function readCreateIpcInvokersCall(
  source: string,
  index: number,
): { channelMapIdentifier: string; end: number } | undefined {
  const ident = readIdentifier(source, index);
  if (!ident || ident.name !== 'createIpcInvokers') return undefined;
  let cursor = skipWhitespace(source, ident.next);
  if (source[cursor] !== '(') return undefined;
  const close = skipBalanced(source, cursor, '(', ')');
  const inner = source.slice(cursor + 1, close - 1).trim();
  if (!/^[A-Za-z_$][\w$]*$/u.test(inner)) return undefined;
  return { channelMapIdentifier: inner, end: close };
}

/**
 * Resolve the channel-map identifiers imported by a preload fragment and map
 * each to the method names of its `export const <name> = { ... }` literal.
 */
function collectChannelMaps(rootDir: string, fileRelative: string): Map<string, Set<string>> {
  const filePath = path.join(rootDir, fileRelative);
  const source = stripTypeScriptComments(fs.readFileSync(filePath, 'utf8'));
  const maps = new Map<string, Set<string>>();
  const importPattern = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(importPattern)) {
    const from = match[2];
    if (!from.endsWith('.channels')) continue;
    for (const spec of match[1].split(',')) {
      const name = spec.trim();
      if (!name) continue;
      const resolved = path.resolve(path.dirname(filePath), `${from}.ts`);
      if (!fs.existsSync(resolved)) continue;
      const channelsSource = stripTypeScriptComments(fs.readFileSync(resolved, 'utf8'));
      let openBrace: number;
      try {
        openBrace = findExportObjectBrace(channelsSource, name);
      } catch {
        continue;
      }
      const names = collectPathsFromObjectLiteralText(channelsSource, openBrace, '');
      maps.set(name, names);
    }
  }
  return maps;
}

export function collectPathsFromPreloadExport(
  rootDir: string,
  fileRelative: string,
  exportName: string,
): Set<string> {
  const filePath = path.join(rootDir, fileRelative);
  const raw = fs.readFileSync(filePath, 'utf8');
  const source = stripTypeScriptComments(raw);
  const openBrace = findExportObjectBrace(source, exportName);
  return collectPathsFromObjectLiteralText(
    source,
    openBrace,
    '',
    collectChannelMaps(rootDir, fileRelative),
  );
}
