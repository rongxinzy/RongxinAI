import { editorHighlightStyle } from '../theme/syntax/codemirror';
import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  LanguageDescription,
  LanguageSupport,
  syntaxHighlighting,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { unifiedMergeView } from '@codemirror/merge';
import {
  closeSearchPanel,
  getSearchQuery,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
  searchPanelOpen,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search';
import { Compartment, EditorState, Extension } from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  Panel,
  rectangularSelection,
} from '@codemirror/view';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import { Button, buttonVariants } from '@shared/components/ui/button';
// CopyIcon removed — using Copy from lucide-react instead
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@shared/components/ui/tooltip';
import CodeMirror from '@uiw/react-codemirror';
import { Check, ChevronDown, ChevronUp, Copy, Download, Search } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { i18nService } from '../services/i18n';

/** Word-wrap toggle icon: mimics a "wrap text" glyph */
const WrapTextIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M3 12h13a3 3 0 0 1 0 6h-3" />
    <polyline points="11 15 8 18 11 21" />
    <line x1="3" y1="18" x2="5" y2="18" />
  </svg>
);

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

const resolveLanguage = (lang: string): LanguageDescription | null => {
  const lower = lang.toLowerCase();
  const canonical = LANGUAGE_ALIAS_MAP[lower] ?? lower;
  const desc = LanguageDescription.matchLanguageName(languages, canonical, true);
  if (desc) return desc;
  if (canonical !== lower) {
    return LanguageDescription.matchLanguageName(languages, lower, true);
  }
  return null;
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useIsDark() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

function useLanguageSupport(languageName: string | null): LanguageSupport | null {
  const [support, setSupport] = useState<LanguageSupport | null>(() => {
    if (!languageName) return null;
    const desc = resolveLanguage(languageName);
    return desc?.support ?? null;
  });

  useEffect(() => {
    if (!languageName) {
      setSupport(null);
      return;
    }
    let cancelled = false;
    const desc = resolveLanguage(languageName);
    if (!desc) {
      setSupport(null);
      return;
    }
    if (desc.support) {
      setSupport(desc.support);
      return;
    }
    desc.load().then(loaded => {
      if (!cancelled) setSupport(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [languageName]);

  return support;
}

// ---------------------------------------------------------------------------
// Diff parsing
// ---------------------------------------------------------------------------

/**
 * Detect whether the content looks like a valid unified diff and, if so,
 * split it into original vs modified text for the merge view.
 *
 * To avoid false positives (e.g. a markdown list whose items happen to start
 * with `-` or `+`), we require that the content exhibits clear diff structure:
 *   1. Has a `@@` hunk header, OR
 *   2. Contains BOTH `-` (deletion) and `+` (addition) lines, AND
 *      the ratio of diff-marker lines (`-`, `+`, or leading space context)
 *      to total non-empty lines is at least 60%.
 */
function parseDiff(raw: string): { original: string; modified: string } | null {
  const lines = raw.split('\n');

  // ── First pass: probe whether this really looks like a diff ──────────
  let hasHunkHeader = false;
  let deletionCount = 0;
  let additionCount = 0;
  let contextCount = 0; // lines starting with a single space (diff context)
  let headerCount = 0; // --- / +++ file headers
  let totalNonEmpty = 0;

  for (const line of lines) {
    if (line.length === 0) continue;
    totalNonEmpty += 1;

    if (line.startsWith('@@')) {
      hasHunkHeader = true;
      headerCount += 1;
    } else if (line.startsWith('---') || line.startsWith('+++')) {
      headerCount += 1;
    } else if (line.startsWith('-')) {
      deletionCount += 1;
    } else if (line.startsWith('+')) {
      additionCount += 1;
    } else if (line.startsWith(' ')) {
      contextCount += 1;
    }
  }

  const hasBothSides = deletionCount > 0 && additionCount > 0;

  if (!hasHunkHeader && !hasBothSides) {
    // Neither a hunk header nor both -/+ lines → not a diff.
    return null;
  }

  if (!hasHunkHeader) {
    // No @@ header — rely on heuristics to avoid false positives.
    // Require that diff-marker lines dominate the content.
    const markerLines = deletionCount + additionCount + contextCount + headerCount;
    if (totalNonEmpty > 0 && markerLines / totalNonEmpty < 0.6) {
      return null;
    }
  }

  // ── Second pass: split into original / modified ──────────────────────
  const originalLines: string[] = [];
  const modifiedLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) {
      continue;
    }
    if (line.startsWith('-')) {
      originalLines.push(line.slice(1));
    } else if (line.startsWith('+')) {
      modifiedLines.push(line.slice(1));
    } else {
      const ctx = line.startsWith(' ') ? line.slice(1) : line;
      originalLines.push(ctx);
      modifiedLines.push(ctx);
    }
  }

  return {
    original: originalLines.join('\n'),
    modified: modifiedLines.join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Custom search panel factory
// ---------------------------------------------------------------------------

/**
 * Counts total matches and the 1-based index of the currently selected match.
 * Zero-width matches (from === to) are excluded — they are invisible in the
 * editor and inflate the count for patterns like `a*` or `.*`.
 * Returns { total, current } where current is 0 if no match is selected.
 */
function getMatchInfo(state: EditorState): { total: number; current: number } {
  const query = getSearchQuery(state);
  if (!query.search || !query.valid) return { total: 0, current: 0 };

  try {
    const cursor = query.getCursor(state.doc);
    const matches: { from: number; to: number }[] = [];
    let result = cursor.next();
    while (!result.done) {
      // Skip zero-width matches — they produce huge false counts for patterns
      // like `a*` or `.*` while being invisible in the highlighted editor.
      if (result.value.from !== result.value.to) {
        matches.push({ from: result.value.from, to: result.value.to });
      }
      result = cursor.next();
    }

    const total = matches.length;
    if (total === 0) return { total: 0, current: 0 };

    const sel = state.selection.main;
    let current = 0;
    for (let i = 0; i < matches.length; i++) {
      if (matches[i].from === sel.from && matches[i].to === sel.to) {
        current = i + 1;
        break;
      }
    }
    return { total, current };
  } catch {
    return { total: 0, current: 0 };
  }
}

/**
 * Navigate to the next non-zero-width match after the current selection.
 * Falls back to wrapping around to the start of the document.
 */
function goToNextMatch(view: EditorView): boolean {
  const query = getSearchQuery(view.state);
  if (!query.search || !query.valid) return false;
  try {
    const doc = view.state.doc;
    const from = view.state.selection.main.to;

    const findFrom = (start: number, end: number) => {
      const cursor = query.getCursor(doc, start, end);
      let result = cursor.next();
      while (!result.done) {
        if (result.value.from !== result.value.to) return result.value;
        result = cursor.next();
      }
      return null;
    };

    const match = findFrom(from, doc.length) ?? findFrom(0, from);
    if (!match) return false;

    view.dispatch({
      selection: { anchor: match.from, head: match.to },
      effects: EditorView.scrollIntoView(match.from, { y: 'nearest' }),
      userEvent: 'select.search',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Navigate to the previous non-zero-width match before the current selection.
 */
function goToPrevMatch(view: EditorView): boolean {
  const query = getSearchQuery(view.state);
  if (!query.search || !query.valid) return false;
  try {
    const doc = view.state.doc;
    const to = view.state.selection.main.from;

    const collectMatches = (start: number, end: number) => {
      const matches: { from: number; to: number }[] = [];
      const cursor = query.getCursor(doc, start, end);
      let result = cursor.next();
      while (!result.done) {
        if (result.value.from !== result.value.to) {
          matches.push({ from: result.value.from, to: result.value.to });
        }
        result = cursor.next();
      }
      return matches;
    };

    const before = collectMatches(0, to);
    const match =
      before.length > 0
        ? before[before.length - 1]
        : (() => {
            const all = collectMatches(to, doc.length);
            return all.length > 0 ? all[all.length - 1] : null;
          })();

    if (!match) return false;

    view.dispatch({
      selection: { anchor: match.from, head: match.to },
      effects: EditorView.scrollIntoView(match.from, { y: 'nearest' }),
      userEvent: 'select.search',
    });
    return true;
  } catch {
    return false;
  }
}

function buildSearchPanel(view: EditorView): Panel {
  const t = (key: string) => i18nService.t(key as any);

  // ── DOM structure ──────────────────────────────────────────────────────────
  const dom = document.createElement('div');
  dom.className = 'cm-search-custom';

  // Search input
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'cm-textfield cm-search-input';
  searchInput.placeholder = t('codeSearchFind');
  searchInput.setAttribute('aria-label', t('codeSearchFind'));
  searchInput.setAttribute('name', 'search');

  // Match count badge: "2 / 10"
  const countBadge = document.createElement('span');
  countBadge.className = 'cm-search-count';
  countBadge.textContent = '';

  // Prev / Next buttons
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = buttonVariants({
    variant: 'outline',
    size: 'icon-sm',
    className: 'cm-search-nav-btn [&_svg]:size-3.5',
  });
  prevBtn.title = t('codeSearchPrev');
  prevBtn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = buttonVariants({
    variant: 'outline',
    size: 'icon-sm',
    className: 'cm-search-nav-btn [&_svg]:size-3.5',
  });
  nextBtn.title = t('codeSearchNext');
  nextBtn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

  // Separator
  const sep = document.createElement('span');
  sep.className = 'cm-search-sep';

  // Option checkboxes
  function makeCheckbox(labelKey: string, name: string) {
    const label = document.createElement('label');
    label.className = 'cm-search-opt';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.name = name;
    const span = document.createElement('span');
    span.textContent = t(labelKey);
    label.appendChild(cb);
    label.appendChild(span);
    return { label, cb };
  }
  const { label: caseLabel, cb: caseCb } = makeCheckbox('codeSearchMatchCase', 'case');
  const { label: reLabel, cb: reCb } = makeCheckbox('codeSearchRegexp', 're');

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = buttonVariants({
    variant: 'ghost',
    size: 'icon-sm',
    className: 'cm-search-close-btn [&_svg]:size-3.5',
  });
  closeBtn.title = t('codeSearchClose');
  closeBtn.setAttribute('aria-label', t('codeSearchClose'));
  closeBtn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  dom.appendChild(searchInput);
  dom.appendChild(prevBtn);
  dom.appendChild(nextBtn);
  dom.appendChild(countBadge);
  dom.appendChild(sep);
  dom.appendChild(caseLabel);
  dom.appendChild(reLabel);
  dom.appendChild(closeBtn);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function currentQuery(): SearchQuery {
    return new SearchQuery({
      search: searchInput.value,
      caseSensitive: caseCb.checked,
      regexp: reCb.checked,
    });
  }

  function commitQuery() {
    const q = currentQuery();
    const prev = getSearchQuery(view.state);
    if (!q.eq(prev)) {
      view.dispatch({ effects: setSearchQuery.of(q) });
    }
  }

  function updateCount(state: EditorState = view.state) {
    if (!searchInput.value) {
      countBadge.textContent = '';
      countBadge.className = 'cm-search-count';
      return;
    }
    // If regexp mode and pattern is invalid, show error indicator
    const q = getSearchQuery(state);
    if (reCb.checked && !q.valid) {
      countBadge.textContent = '!';
      countBadge.className = 'cm-search-count cm-search-count--none';
      return;
    }
    const { total, current } = getMatchInfo(state);
    if (total === 0) {
      countBadge.textContent = t('codeSearchNoMatch');
      countBadge.className = 'cm-search-count cm-search-count--none';
    } else {
      countBadge.textContent = current > 0 ? `${current} / ${total}` : `${total}`;
      countBadge.className = 'cm-search-count';
    }
  }

  // ── Event listeners ────────────────────────────────────────────────────────
  searchInput.addEventListener('input', () => {
    commitQuery();
  });
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) goToPrevMatch(view);
      else goToNextMatch(view);
    } else if (e.key === 'Escape') {
      closeSearchPanel(view);
    }
  });

  caseCb.addEventListener('change', () => commitQuery());
  reCb.addEventListener('change', () => commitQuery());

  prevBtn.addEventListener('click', () => {
    goToPrevMatch(view);
    searchInput.focus();
  });
  nextBtn.addEventListener('click', () => {
    goToNextMatch(view);
    searchInput.focus();
  });
  closeBtn.addEventListener('click', () => closeSearchPanel(view));

  // ── Panel interface ────────────────────────────────────────────────────────
  return {
    dom,
    top: true,
    mount() {
      searchInput.focus();
      // Sync existing query into our inputs (e.g. if panel reopened)
      const q = getSearchQuery(view.state);
      if (q.search) {
        searchInput.value = q.search;
        caseCb.checked = q.caseSensitive;
        reCb.checked = q.regexp;
        updateCount();
      }
    },
    update(update) {
      if (
        update.selectionSet ||
        update.docChanged ||
        update.transactions.some(tr => tr.effects.length > 0)
      ) {
        updateCount(update.state);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// CodeMirror theme extensions (module-level, stable references)
// ---------------------------------------------------------------------------

const baseTheme = EditorView.theme({
  '&': {
    fontSize: 'var(--zy-component-text-sm)',
    fontFamily: 'var(--zy-style-font-mono)',
  },
  '.cm-gutters': { border: 'none', userSelect: 'none' },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '2.5em',
    padding: '0 8px 0 4px',
    fontSize: 'var(--zy-component-text-xs)',
    opacity: '0.5',
  },
  '.cm-content': { padding: '8px 0' },
  '.cm-line': { padding: '0 12px' },
  '.cm-cursor': { display: 'none !important' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto' },
  // Diff colors
  '.cm-deletedChunk': { backgroundColor: 'var(--zy-component-editor-deleted-chunk)' },
  '.cm-insertedChunk': { backgroundColor: 'var(--zy-component-editor-inserted-chunk)' },
  '.cm-changedText': { backgroundColor: 'var(--zy-component-editor-changed)' },
  // Custom search panel
  '.cm-search-custom': {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '5px 10px',
    borderBottom: '1px solid var(--zy-border)',
    background: 'var(--zy-surface-raised)',
    fontFamily: 'var(--zy-style-font-mono)',
    fontSize: 'var(--zy-component-text-xs)',
  },
  '.cm-search-input': {
    flex: '0 0 160px',
    height: '26px',
    padding: '0 8px',
    borderRadius: 'var(--zy-style-radius-sm)',
    border: '1px solid var(--zy-border)',
    background: 'var(--zy-surface)',
    color: 'var(--zy-foreground)',
    fontSize: 'var(--zy-component-text-xs)',
    outline: 'none',
  },
  '.cm-search-input:focus': {
    borderColor: 'var(--zy-primary)',
  },
  '.cm-search-count': {
    flex: '0 0 auto',
    minWidth: '36px',
    fontSize: 'var(--zy-component-text-xs)',
    color: 'var(--zy-text-secondary)',
    textAlign: 'center',
    fontVariantNumeric: 'tabular-nums',
  },
  '.cm-search-count--none': {
    color: 'var(--zy-component-editor-error)',
  },
  '.cm-search-nav-btn': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '26px',
    height: '26px',
    padding: '0',
    borderRadius: 'var(--zy-style-radius-sm)',
    border: '1px solid var(--zy-border)',
    background: 'var(--zy-surface-raised)',
    color: 'var(--zy-text-secondary)',
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
  },
  '.cm-search-nav-btn:hover': {
    background: 'var(--zy-surface-tertiary)',
    color: 'var(--zy-foreground)',
  },
  '.cm-search-sep': {
    width: '1px',
    height: '16px',
    background: 'var(--zy-border)',
    margin: '0 2px',
    flex: '0 0 auto',
  },
  '.cm-search-opt': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    height: '26px',
    padding: '0 6px',
    borderRadius: 'var(--zy-style-radius-sm)',
    border: '1px solid transparent',
    fontSize: 'var(--zy-component-text-xs)',
    color: 'var(--zy-text-secondary)',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'background 0.15s, border-color 0.15s, color 0.15s',
    whiteSpace: 'nowrap',
  },
  '.cm-search-opt:hover': {
    background: 'var(--zy-surface-raised)',
    color: 'var(--zy-foreground)',
  },
  '.cm-search-opt input[type="checkbox"]': {
    margin: '0',
    cursor: 'pointer',
    accentColor: 'var(--zy-primary)',
  },
  '.cm-search-close-btn': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '26px',
    height: '26px',
    padding: '0',
    marginLeft: 'auto',
    borderRadius: 'var(--zy-style-radius-sm)',
    border: 'none',
    background: 'transparent',
    color: 'var(--zy-text-secondary)',
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
  },
  '.cm-search-close-btn:hover': {
    background: 'var(--zy-surface-raised)',
    color: 'var(--zy-foreground)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--zy-component-editor-search)',
    borderRadius: '2px',
  },
  '.cm-searchMatch-selected': { backgroundColor: 'var(--zy-component-editor-search-selected)' },
  // Indentation markers
  '.cm-indent-markers': {
    '--indent-marker-bg-color': 'var(--zy-component-editor-indent-fallback)',
    '--indent-marker-active-bg-color': 'var(--zy-component-editor-indent-active-fallback)',
  },
});

const darkThemeExt = EditorView.theme({
  '&': {
    backgroundColor: 'var(--zy-component-editor-background)',
    color: 'var(--zy-component-editor-foreground)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--zy-component-editor-background)',
    color: 'var(--zy-component-editor-gutter)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--zy-component-editor-selection) !important',
  },
  '.cm-activeLine': { backgroundColor: 'var(--zy-component-editor-active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--zy-component-editor-active-line)' },
  '.cm-deletedChunk .cm-line, .cm-changedChunk .cm-deletedLine': {
    backgroundColor: 'var(--zy-component-editor-deleted)',
  },
  '.cm-insertedChunk .cm-line, .cm-changedChunk .cm-insertedLine': {
    backgroundColor: 'var(--zy-component-editor-inserted)',
  },
  '.cm-indent-markers': {
    '--indent-marker-bg-color': 'var(--zy-component-editor-indent)',
    '--indent-marker-active-bg-color': 'var(--zy-component-editor-indent-active)',
  },
});

const lightThemeExt = EditorView.theme({
  '&': {
    backgroundColor: 'var(--zy-component-editor-background)',
    color: 'var(--zy-component-editor-foreground)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--zy-component-editor-background)',
    color: 'var(--zy-component-editor-gutter)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--zy-component-editor-selection) !important',
  },
  '.cm-activeLine': { backgroundColor: 'var(--zy-component-editor-active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--zy-component-editor-active-line)' },
  '.cm-deletedChunk .cm-line, .cm-changedChunk .cm-deletedLine': {
    backgroundColor: 'var(--zy-component-editor-deleted)',
  },
  '.cm-insertedChunk .cm-line, .cm-changedChunk .cm-insertedLine': {
    backgroundColor: 'var(--zy-component-editor-inserted)',
  },
  '.cm-indent-markers': {
    '--indent-marker-bg-color': 'var(--zy-component-editor-indent)',
    '--indent-marker-active-bg-color': 'var(--zy-component-editor-indent-active)',
  },
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CODE_BLOCK_LINE_LIMIT = 200;
const CODE_BLOCK_CHAR_LIMIT = 20000;

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

function inferFileExtension(lang: string | null): string {
  if (!lang) return 'txt';
  const lower = lang.toLowerCase();
  return LANG_TO_EXT[lower] ?? lower;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Fullscreen modal
// ---------------------------------------------------------------------------

interface CodeFullscreenModalProps {
  code: string;
  lang: string | null;
  isDark: boolean;
  onClose: () => void;
}

const CodeFullscreenModal: React.FC<CodeFullscreenModalProps> = ({
  code,
  lang,
  isDark,
  onClose,
}) => {
  const [wrap, setWrap] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const viewRef = useRef<EditorView | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const langSupport = useLanguageSupport(lang);

  // Close on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setIsCopied(true);
      if (copyTimeoutRef.current != null) window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = window.setTimeout(() => setIsCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy in fullscreen modal:', err);
    }
  }, [code]);

  const handleToggleSearch = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    if (searchPanelOpen(view.state)) {
      closeSearchPanel(view);
    } else {
      openSearchPanel(view);
      view.focus();
    }
  }, []);

  const handleViewReady = useCallback((view: EditorView | null) => {
    viewRef.current = view;
  }, []);

  const t = (key: string) => i18nService.t(key as any);

  return createPortal(
    <div
      className="fixed inset-0 z-200 flex flex-col"
      style={{ backgroundColor: 'var(--zy-component-overlay-strong)', backdropFilter: 'blur(4px)' }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Modal container */}
      <div
        className="flex flex-col m-8 rounded-xl overflow-hidden border border-border shadow-2xl"
        style={{ flex: 1, minHeight: 0, backgroundColor: 'var(--zy-component-editor-background)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="bg-surface-raised px-4 py-2 flex items-center justify-between border-b border-border shrink-0">
          <span className="font-mono text-xs text-muted-foreground opacity-70">
            {lang ?? 'code'}
          </span>
          <div className="flex items-center gap-0.5">
            <CodeBlockTooltip
              content={searchOpen ? t('codeBlockSearchClose') : t('codeBlockSearch')}
            >
              <HeaderButton
                onClick={handleToggleSearch}
                ariaLabel={searchOpen ? t('codeBlockSearchClose') : t('codeBlockSearch')}
                active={searchOpen}
              >
                <Search className="h-4 w-4" />
              </HeaderButton>
            </CodeBlockTooltip>
            <CodeBlockTooltip content={wrap ? t('codeBlockWordWrapOff') : t('codeBlockWordWrap')}>
              <HeaderButton
                onClick={() => setWrap(v => !v)}
                ariaLabel={wrap ? t('codeBlockWordWrapOff') : t('codeBlockWordWrap')}
                active={wrap}
              >
                <WrapTextIcon className="h-4 w-4" />
              </HeaderButton>
            </CodeBlockTooltip>
            <CodeBlockTooltip content={t('copyToClipboard')}>
              <HeaderButton onClick={handleCopy} ariaLabel={t('copyToClipboard')}>
                {isCopied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </HeaderButton>
            </CodeBlockTooltip>
            {/* Divider */}
            <span className="w-px h-4 bg-border mx-1" />
            {/* Close */}
            <CodeBlockTooltip content={t('codeBlockFullscreenExit')}>
              <HeaderButton onClick={onClose} ariaLabel={t('codeBlockFullscreenExit')}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </HeaderButton>
            </CodeBlockTooltip>
          </div>
        </div>
        {/* Modal body — scrollable editor */}
        <div className="flex-1 overflow-auto">
          <CodeMirrorEditor
            doc={code}
            isDark={isDark}
            wrap={wrap}
            langSupport={langSupport}
            onViewReady={handleViewReady}
            onSearchOpenChange={setSearchOpen}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
};

const CodeBlockTooltip: React.FC<{
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ content, children, className }) => (
  <TooltipProvider delay={300}>
    <Tooltip>
      <TooltipTrigger render={<div className={className}>{children}</div>} />
      <TooltipContent
        side="bottom"
        align="end"
        className="bg-surface-overlay text-foreground border-border shadow-lg"
      >
        {content}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

/** Thin icon button used in the code block header */
const HeaderButton: React.FC<{
  onClick: () => void;
  ariaLabel: string;
  active?: boolean;
  children: React.ReactNode;
}> = ({ onClick, ariaLabel, active = false, children }) => (
  <Button
    type="button"
    variant="ghost"
    size="icon"
    onClick={onClick}
    className={[
      'h-7 w-7 rounded-md transition-colors transform-gpu',
      active
        ? 'bg-surface text-foreground'
        : 'text-muted-foreground hover:bg-surface hover:text-foreground',
    ].join(' ')}
    aria-label={ariaLabel}
  >
    {children}
  </Button>
);

// ---------------------------------------------------------------------------
// Unified diff view component
// ---------------------------------------------------------------------------

interface DiffViewProps {
  original: string;
  modified: string;
  langSupport: LanguageSupport | null;
  isDark: boolean;
  wrap: boolean;
}

const DiffView: React.FC<DiffViewProps> = ({ original, modified, langSupport, isDark, wrap }) => {
  const extensions = useMemo(() => {
    const exts: Extension[] = [
      baseTheme,
      isDark ? darkThemeExt : lightThemeExt,
      EditorView.editable.of(false),
      unifiedMergeView({
        original,
        highlightChanges: true,
        gutter: true,
        mergeControls: false,
        syntaxHighlightDeletions: true,
        allowInlineDiffs: true,
      }),
    ];
    if (wrap) exts.push(EditorView.lineWrapping);
    if (langSupport) exts.push(langSupport);
    return exts;
  }, [original, isDark, wrap, langSupport]);

  return (
    <CodeMirror
      value={modified}
      extensions={extensions}
      editable={false}
      readOnly={true}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        indentOnInput: false,
        bracketMatching: false,
        closeBrackets: false,
        autocompletion: false,
        rectangularSelection: false,
        crosshairCursor: false,
        dropCursor: false,
        allowMultipleSelections: false,
        searchKeymap: false,
        highlightSelectionMatches: false,
      }}
      theme="none"
    />
  );
};

// ---------------------------------------------------------------------------
// useCodeMirrorView — creates and manages a raw EditorView with Compartments
// so dynamic props (theme, wrap, language) can be reconfigured without
// destroying the search panel state.
// ---------------------------------------------------------------------------

interface UseCodeMirrorViewOptions {
  container: HTMLDivElement | null;
  doc: string;
  isDark: boolean;
  wrap: boolean;
  langSupport: LanguageSupport | null;
  onSearchOpenChange: (open: boolean) => void;
}

function useCodeMirrorView({
  container,
  doc,
  isDark,
  wrap,
  langSupport,
  onSearchOpenChange,
}: UseCodeMirrorViewOptions): EditorView | null {
  const viewRef = useRef<EditorView | null>(null);

  // Stable compartments (created once per CodeBlock instance)
  const themeCompartment = useRef(new Compartment());
  const wrapCompartment = useRef(new Compartment());
  const langCompartment = useRef(new Compartment());

  // Keep a ref to the callback so the updateListener doesn't go stale
  const onSearchOpenChangeRef = useRef(onSearchOpenChange);
  onSearchOpenChangeRef.current = onSearchOpenChange;

  // Expose the current view via a ref for imperative access
  const [, forceUpdate] = useState(0);

  // Create the view once when the container is mounted
  useEffect(() => {
    if (!container) return;

    const initialTheme = isDark ? darkThemeExt : lightThemeExt;
    const initialWrap = wrap ? EditorView.lineWrapping : [];
    const initialLang: Extension = langSupport ?? [];

    const state = EditorState.create({
      doc,
      extensions: [
        // ── Static extensions (never reconfigured) ──────────────────────
        baseTheme,
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),

        // Line numbers + fold gutter
        lineNumbers(),
        foldGutter(),

        // Bracket matching, selection highlight
        bracketMatching(),
        highlightSelectionMatches(),
        drawSelection(),

        // Active line highlight
        highlightActiveLine(),
        highlightActiveLineGutter(),

        // Multi-selection
        rectangularSelection(),
        crosshairCursor(),

        // Indentation guides
        indentationMarkers(),

        // Syntax highlighting
        syntaxHighlighting(editorHighlightStyle),

        // Search — custom panel with match counter
        search({ createPanel: buildSearchPanel }),

        // Keymaps
        keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap]),

        // Listener to sync searchOpen React state with editor panel state
        EditorView.updateListener.of(update => {
          if (update.transactions.length > 0) {
            onSearchOpenChangeRef.current(searchPanelOpen(update.state));
          }
        }),

        // ── Dynamic compartments (reconfigured on prop changes) ─────────
        themeCompartment.current.of(initialTheme),
        wrapCompartment.current.of(initialWrap),
        langCompartment.current.of(initialLang),
      ],
    });

    const view = new EditorView({ state, parent: container });
    viewRef.current = view;
    forceUpdate(n => n + 1); // tell consumers the view is ready

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container]); // only re-create when the DOM container changes

  // Reconfigure theme compartment when isDark changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.current.reconfigure(isDark ? darkThemeExt : lightThemeExt),
    });
  }, [isDark]);

  // Reconfigure wrap compartment when wrap changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wrapCompartment.current.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
  }, [wrap]);

  // Reconfigure language compartment when langSupport changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: langCompartment.current.reconfigure(langSupport ?? []),
    });
  }, [langSupport]);

  // Update document content if it changes (shouldn't happen for read-only
  // chat messages, but guard anyway)
  const prevDocRef = useRef(doc);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || doc === prevDocRef.current) return;
    prevDocRef.current = doc;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: doc },
    });
  }, [doc]);

  return viewRef.current;
}

// ---------------------------------------------------------------------------
// CodeMirrorEditor — thin wrapper that mounts the view into a DOM div
// ---------------------------------------------------------------------------

interface CodeMirrorEditorProps {
  doc: string;
  isDark: boolean;
  wrap: boolean;
  langSupport: LanguageSupport | null;
  onViewReady: (view: EditorView | null) => void;
  onSearchOpenChange: (open: boolean) => void;
}

const CodeMirrorEditor: React.FC<CodeMirrorEditorProps> = ({
  doc,
  isDark,
  wrap,
  langSupport,
  onViewReady,
  onSearchOpenChange,
}) => {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  const view = useCodeMirrorView({
    container,
    doc,
    isDark,
    wrap,
    langSupport,
    onSearchOpenChange,
  });

  // Notify parent when view changes
  useEffect(() => {
    onViewReady(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  return <div ref={setContainer} />;
};

// ---------------------------------------------------------------------------
// Main CodeBlock component
// ---------------------------------------------------------------------------

interface CodeBlockProps {
  node?: any;
  className?: string;
  children?: React.ReactNode;
  inline?: boolean;
  [key: string]: any;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ node, className, children, ...props }) => {
  const normalizedClassName = Array.isArray(className) ? className.join(' ') : className || '';
  const match = /language-([\w-]+)/.exec(normalizedClassName);
  const hasPosition = node?.position?.start?.line != null && node?.position?.end?.line != null;
  const isInline =
    typeof props.inline === 'boolean'
      ? props.inline
      : hasPosition
        ? node.position.start.line === node.position.end.line
        : !match;

  const codeText = Array.isArray(children) ? children.join('') : String(children);
  const trimmedCodeText = codeText.replace(/\n$/, '');

  const rawLang = match ? match[1].toLowerCase() : null;

  // Detect diff blocks: ```diff or ```diff:typescript
  const isDiffBlock = rawLang === 'diff' || rawLang?.startsWith('diff:') === true;
  const diffInnerLang = isDiffBlock && rawLang!.includes(':') ? rawLang!.split(':')[1] : null;

  const shouldUseCodeMirror =
    !isInline &&
    match &&
    trimmedCodeText.length <= CODE_BLOCK_CHAR_LIMIT &&
    trimmedCodeText.split('\n').length <= CODE_BLOCK_LINE_LIMIT;

  // For diff blocks, parse original vs modified
  const diffParsed = useMemo(() => {
    if (!isDiffBlock || !shouldUseCodeMirror) return null;
    return parseDiff(trimmedCodeText);
  }, [isDiffBlock, shouldUseCodeMirror, trimmedCodeText]);

  // Resolve language for syntax highlight
  const syntaxLangName = isDiffBlock ? diffInnerLang : rawLang;
  const langSupport = useLanguageSupport(shouldUseCodeMirror ? syntaxLangName : null);

  const [isCopied, setIsCopied] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const isDark = useIsDark();

  useEffect(
    () => () => {
      if (copyTimeoutRef.current != null) window.clearTimeout(copyTimeoutRef.current);
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(trimmedCodeText);
      setIsCopied(true);
      if (copyTimeoutRef.current != null) window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = window.setTimeout(() => setIsCopied(false), 1500);
    } catch (error) {
      console.error('Failed to copy code block: ', error);
    }
  }, [trimmedCodeText]);

  const savedTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (savedTimeoutRef.current != null) window.clearTimeout(savedTimeoutRef.current);
    },
    [],
  );

  const handleSave = useCallback(() => {
    try {
      const ext = inferFileExtension(rawLang);
      const fileName = `code.${ext}`;
      const blob = new Blob([trimmedCodeText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setIsSaved(true);
      if (savedTimeoutRef.current != null) window.clearTimeout(savedTimeoutRef.current);
      savedTimeoutRef.current = window.setTimeout(() => setIsSaved(false), 1500);
    } catch (error) {
      console.error('Failed to save code block: ', error);
    }
  }, [trimmedCodeText, rawLang]);

  const handleToggleSearch = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const isOpen = searchPanelOpen(view.state);
    if (isOpen) {
      closeSearchPanel(view);
    } else {
      openSearchPanel(view);
      view.focus();
    }
    // searchOpen state is synced by the updateListener in useCodeMirrorView
  }, []);

  const handleToggleCollapse = useCallback(() => {
    setCollapsed(v => !v);
  }, []);

  const handleViewReady = useCallback((view: EditorView | null) => {
    viewRef.current = view;
  }, []);

  // -------------------------------------------------------------------------
  // Inline code
  // -------------------------------------------------------------------------
  if (isInline) {
    const inlineClassName = [
      'inline bg-transparent px-0.5 text-[0.92em] font-mono font-medium text-foreground',
      normalizedClassName,
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <code className={inlineClassName} {...props}>
        {children}
      </code>
    );
  }

  // -------------------------------------------------------------------------
  // No-language plain block
  // -------------------------------------------------------------------------
  if (!match) {
    return (
      <div className="my-2 relative group">
        <div className="overflow-x-auto rounded-lg border border-border-subtle bg-editor-background text-sm leading-6">
          <CodeBlockTooltip
            content={i18nService.t('copyToClipboard')}
            className="absolute top-2 right-2 z-10 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity duration-200"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleCopy}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-raised hover:text-foreground transition-colors transform-gpu"
              aria-label={i18nService.t('copyToClipboard')}
            >
              {isCopied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </CodeBlockTooltip>
          <code className="block px-4 py-3 font-mono text-editor-foreground whitespace-pre">
            {trimmedCodeText}
          </code>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Language code block header
  // -------------------------------------------------------------------------
  const displayLang = isDiffBlock ? (diffInnerLang ? `diff · ${diffInnerLang}` : 'diff') : match[1];

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-border-subtle bg-surface-raised/40 relative">
      {/* Fullscreen modal */}
      {fullscreen && (
        <CodeFullscreenModal
          code={trimmedCodeText}
          lang={rawLang}
          isDark={isDark}
          onClose={() => setFullscreen(false)}
        />
      )}
      {/* Header */}
      <div className="bg-surface-raised/70 border-b border-border-subtle px-3.5 py-1.5 text-xs text-muted-foreground font-medium flex items-center justify-between">
        <span className="font-mono opacity-70">{displayLang}</span>
        <div className="flex items-center gap-0.5">
          {/* Collapse / expand the entire code body */}
          <CodeBlockTooltip
            content={
              collapsed ? i18nService.t('codeBlockExpand') : i18nService.t('codeBlockCollapse')
            }
          >
            <HeaderButton
              onClick={handleToggleCollapse}
              ariaLabel={
                collapsed ? i18nService.t('codeBlockExpand') : i18nService.t('codeBlockCollapse')
              }
              active={collapsed}
            >
              {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </HeaderButton>
          </CodeBlockTooltip>
          {/* Search toggle - only for regular code blocks (not diff) */}
          {!isDiffBlock && (
            <CodeBlockTooltip
              content={
                searchOpen
                  ? i18nService.t('codeBlockSearchClose')
                  : i18nService.t('codeBlockSearch')
              }
            >
              <HeaderButton
                onClick={handleToggleSearch}
                ariaLabel={
                  searchOpen
                    ? i18nService.t('codeBlockSearchClose')
                    : i18nService.t('codeBlockSearch')
                }
                active={searchOpen}
              >
                <Search className="h-4 w-4" />
              </HeaderButton>
            </CodeBlockTooltip>
          )}
          {/* Word wrap toggle */}
          <CodeBlockTooltip
            content={
              wrap ? i18nService.t('codeBlockWordWrapOff') : i18nService.t('codeBlockWordWrap')
            }
          >
            <HeaderButton
              onClick={() => setWrap(v => !v)}
              ariaLabel={
                wrap ? i18nService.t('codeBlockWordWrapOff') : i18nService.t('codeBlockWordWrap')
              }
              active={wrap}
            >
              <WrapTextIcon className="h-4 w-4" />
            </HeaderButton>
          </CodeBlockTooltip>
          {/* Fullscreen expand */}
          <CodeBlockTooltip content={i18nService.t('codeBlockFullscreen')}>
            <HeaderButton
              onClick={() => setFullscreen(true)}
              ariaLabel={i18nService.t('codeBlockFullscreen')}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </HeaderButton>
          </CodeBlockTooltip>
          {/* Copy */}
          <CodeBlockTooltip content={i18nService.t('copyToClipboard')}>
            <HeaderButton onClick={handleCopy} ariaLabel={i18nService.t('copyToClipboard')}>
              {isCopied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </HeaderButton>
          </CodeBlockTooltip>
          {/* Save to file */}
          <CodeBlockTooltip content={i18nService.t('saveToFile')}>
            <HeaderButton onClick={handleSave} ariaLabel={i18nService.t('saveToFile')}>
              {isSaved ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </HeaderButton>
          </CodeBlockTooltip>
        </div>
      </div>

      {/* Body - hidden when collapsed */}
      {!collapsed &&
        (shouldUseCodeMirror ? (
          isDiffBlock && diffParsed ? (
            <DiffView
              original={diffParsed.original}
              modified={diffParsed.modified}
              langSupport={langSupport}
              isDark={isDark}
              wrap={wrap}
            />
          ) : (
            <CodeMirrorEditor
              doc={trimmedCodeText}
              isDark={isDark}
              wrap={wrap}
              langSupport={langSupport}
              onViewReady={handleViewReady}
              onSearchOpenChange={setSearchOpen}
            />
          )
        ) : (
          <div className="m-0 overflow-x-auto bg-editor-background text-sm leading-6">
            <code className="block px-4 py-3 font-mono text-editor-foreground whitespace-pre">
              {trimmedCodeText}
            </code>
          </div>
        ))}
    </div>
  );
};

export default CodeBlock;
