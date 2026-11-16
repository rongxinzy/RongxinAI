// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { HistoryScrollAnchor } from './HistoryScrollAnchor';

const fixture = vi.hoisted(() => ({ scroller: null as HTMLElement | null, atBottom: false }));
vi.mock('use-stick-to-bottom', () => ({
  useStickToBottomContext: () => ({
    scrollRef: { current: fixture.scroller },
    state: {
      get isAtBottom() {
        return fixture.atBottom;
      },
      get scrollTop() {
        return fixture.scroller?.scrollTop ?? 0;
      },
      set scrollTop(value: number) {
        if (fixture.scroller) fixture.scroller.scrollTop = value;
      },
    },
  }),
}));
afterEach(() => {
  cleanup();
  fixture.scroller?.remove();
  vi.restoreAllMocks();
});

test.each([false, true])(
  'history prepend preserves the visible anchor only when the user escaped the tail (%s)',
  atBottom => {
    const scroller = document.createElement('div');
    document.body.appendChild(scroller);
    fixture.scroller = scroller;
    fixture.atBottom = atBottom;
    scroller.scrollTop = 50;
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 300));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (!this.hasAttribute('data-turn-id')) return new DOMRect();
      const rows = [...scroller.querySelectorAll('[data-turn-id]')];
      return new DOMRect(0, rows.indexOf(this) * 160 - scroller.scrollTop, 600, 160);
    });
    const view = (ids: string[]) =>
      createElement(
        HistoryScrollAnchor,
        {
          firstTurnId: ids[0],
          lastTurnId: ids.at(-1),
        },
        ids.map(id => createElement('section', { key: id, 'data-turn-id': id }, id)),
      );
    const { rerender } = render(view(['u10', 'u11']), { container: scroller });
    rerender(view(['u8', 'u9', 'u10', 'u11']));
    expect(scroller.scrollTop).toBe(atBottom ? 50 : 370);
  },
);

test('a history page completing an orphan turn restores the same message after its wrapper remounts', () => {
  const scroller = document.createElement('div');
  document.body.appendChild(scroller);
  fixture.scroller = scroller;
  fixture.atBottom = false;
  scroller.scrollTop = 50;
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 300));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const messages = [...scroller.querySelectorAll('[data-conversation-anchor]')];
    return new DOMRect(0, messages.indexOf(this) * 160 - scroller.scrollTop, 600, 160);
  });
  const view = (complete: boolean) =>
    createElement(
      HistoryScrollAnchor,
      { firstTurnId: complete ? 'u9' : 'orphan-a10', lastTurnId: 'u11' },
      [
        createElement(
          'section',
          { key: complete ? 'u9' : 'orphan-a10', 'data-turn-id': complete ? 'u9' : 'orphan-a10' },
          (complete ? ['u9', 'a9', 'a10'] : ['a10']).map(id =>
            createElement('div', { key: id, 'data-conversation-anchor': id }, id),
          ),
        ),
        createElement(
          'section',
          { key: 'u11', 'data-turn-id': 'u11' },
          createElement('div', { 'data-conversation-anchor': 'a11' }, 'a11'),
        ),
      ],
    );
  const { rerender } = render(view(false), { container: scroller });
  rerender(view(true));
  expect(scroller.scrollTop).toBe(370);
});
