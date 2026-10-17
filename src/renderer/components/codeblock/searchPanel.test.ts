import { search, SearchQuery, setSearchQuery } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { describe, expect, test } from 'vitest';

import { getMatchInfo } from './searchPanel';

function makeState(doc: string, query: SearchQuery, selection?: { anchor: number; head: number }) {
  let state = EditorState.create({
    doc,
    extensions: [search()],
    ...(selection ? { selection } : {}),
  });
  state = state.update({ effects: setSearchQuery.of(query) }).state;
  return state;
}

describe('getMatchInfo', () => {
  test('returns zeros when no query is set', () => {
    const state = EditorState.create({ doc: 'foo bar', extensions: [search()] });
    expect(getMatchInfo(state)).toEqual({ total: 0, current: 0 });
  });

  test('counts all literal matches', () => {
    const state = makeState('foo bar foo', new SearchQuery({ search: 'foo' }));
    expect(getMatchInfo(state)).toEqual({ total: 2, current: 0 });
  });

  test('reports the 1-based index of the selected match', () => {
    const state = makeState('foo bar foo', new SearchQuery({ search: 'foo' }), {
      anchor: 8,
      head: 11,
    });
    expect(getMatchInfo(state)).toEqual({ total: 2, current: 2 });
  });

  test('respects case sensitivity', () => {
    const state = makeState('Foo foo fOO', new SearchQuery({ search: 'foo', caseSensitive: true }));
    expect(getMatchInfo(state)).toEqual({ total: 1, current: 0 });
  });

  test('counts regex matches', () => {
    const state = makeState('a1 b22 c333', new SearchQuery({ search: '\\d+', regexp: true }));
    expect(getMatchInfo(state)).toEqual({ total: 3, current: 0 });
  });

  test('excludes zero-width matches from the count', () => {
    // `a*` matches zero-width at several offsets; only the actual "a" is visible.
    const state = makeState('bab', new SearchQuery({ search: 'a*', regexp: true }));
    expect(getMatchInfo(state)).toEqual({ total: 1, current: 0 });
  });

  test('returns zeros for an invalid regex without throwing', () => {
    const state = makeState('text', new SearchQuery({ search: '(', regexp: true }));
    expect(getMatchInfo(state)).toEqual({ total: 0, current: 0 });
  });

  test('returns zeros when the query matches nothing', () => {
    const state = makeState('nothing here', new SearchQuery({ search: 'zzz' }));
    expect(getMatchInfo(state)).toEqual({ total: 0, current: 0 });
  });
});
