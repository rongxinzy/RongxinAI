import { closeSearchPanel, getSearchQuery, SearchQuery, setSearchQuery } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView, Panel } from '@codemirror/view';
import { buttonVariants } from '@shared/components/ui/button';

import { i18nService } from '../../services/i18n';

// ---------------------------------------------------------------------------
// Custom search panel factory
// ---------------------------------------------------------------------------

/**
 * Counts total matches and the 1-based index of the currently selected match.
 * Zero-width matches (from === to) are excluded — they are invisible in the
 * editor and inflate the count for patterns like `a*` or `.*`.
 * Returns { total, current } where current is 0 if no match is selected.
 */
export function getMatchInfo(state: EditorState): { total: number; current: number } {
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

export function buildSearchPanel(view: EditorView): Panel {
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
    className: 'cm-search-nav-btn',
  });
  prevBtn.title = t('codeSearchPrev');
  prevBtn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = buttonVariants({
    variant: 'outline',
    size: 'icon-sm',
    className: 'cm-search-nav-btn',
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
    className: 'cm-search-close-btn',
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
