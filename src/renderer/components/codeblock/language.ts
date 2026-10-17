import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

// ---------------------------------------------------------------------------
// Language alias map
// ---------------------------------------------------------------------------

const LANGUAGE_ALIAS_MAP: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  tsx: 'tsx',
  jsx: 'jsx',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  md: 'markdown',
  objc: 'objective-c',
  'c++': 'c++',
  'c#': 'c#',
  cs: 'c#',
  kt: 'kotlin',
  dockerfile: 'dockerfile',
  tf: 'hcl',
  proto: 'protobuf',
  graphql: 'graphql',
  gql: 'graphql',
};

export const resolveLanguage = (lang: string): LanguageDescription | null => {
  const lower = lang.toLowerCase();
  const canonical = LANGUAGE_ALIAS_MAP[lower] ?? lower;
  const desc = LanguageDescription.matchLanguageName(languages, canonical, true);
  if (desc) return desc;
  if (canonical !== lower) {
    return LanguageDescription.matchLanguageName(languages, lower, true);
  }
  return null;
};

/**
 * Maps language identifiers (as they appear in fenced code blocks) to their
 * canonical file extensions. Covers the most common languages; falls back to
 * the raw language string when no mapping is found.
 */
const LANG_TO_EXT: Record<string, string> = {
  // Web
  javascript: 'js',
  js: 'js',
  jsx: 'jsx',
  typescript: 'ts',
  ts: 'ts',
  tsx: 'tsx',
  html: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  // Systems
  python: 'py',
  py: 'py',
  ruby: 'rb',
  rb: 'rb',
  rust: 'rs',
  rs: 'rs',
  go: 'go',
  java: 'java',
  kotlin: 'kt',
  kt: 'kt',
  swift: 'swift',
  'c++': 'cpp',
  cpp: 'cpp',
  'c#': 'cs',
  cs: 'cs',
  c: 'c',
  'objective-c': 'm',
  objc: 'm',
  // Scripting / config
  shell: 'sh',
  bash: 'sh',
  sh: 'sh',
  zsh: 'sh',
  powershell: 'ps1',
  ps1: 'ps1',
  lua: 'lua',
  perl: 'pl',
  php: 'php',
  r: 'r',
  matlab: 'm',
  // Data / markup
  json: 'json',
  yaml: 'yaml',
  yml: 'yml',
  toml: 'toml',
  xml: 'xml',
  markdown: 'md',
  md: 'md',
  csv: 'csv',
  // Infrastructure / query
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'dockerfile',
  hcl: 'tf',
  tf: 'tf',
  protobuf: 'proto',
  proto: 'proto',
  // Other
  scala: 'scala',
  elixir: 'ex',
  erlang: 'erl',
  haskell: 'hs',
  clojure: 'clj',
  dart: 'dart',
  vue: 'vue',
  svelte: 'svelte',
};

export function inferFileExtension(lang: string | null): string {
  if (!lang) return 'txt';
  const lower = lang.toLowerCase();
  return LANG_TO_EXT[lower] ?? lower;
}
