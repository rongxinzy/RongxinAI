import { describe, expect, test } from 'vitest';

import { resolveActiveRailIndex } from './useConversationRailScrollSync';

describe('resolveActiveRailIndex', () => {
  test('uses the last rail item when scrolled near the bottom', () => {
    expect(
      resolveActiveRailIndex(
        {
          scrollTop: 776,
          scrollHeight: 1200,
          clientHeight: 400,
          viewportTop: 0,
        },
        [
          { railIndex: 0, top: -300 },
          { railIndex: 1, top: -20 },
          { railIndex: 2, top: 220 },
        ],
      ),
    ).toBe(2);
  });

  test('selects the latest rail item above the reading anchor', () => {
    expect(
      resolveActiveRailIndex(
        {
          scrollTop: 240,
          scrollHeight: 1200,
          clientHeight: 400,
          viewportTop: 0,
        },
        [
          { railIndex: 0, top: -220 },
          { railIndex: 1, top: 120 },
          { railIndex: 2, top: 260 },
        ],
      ),
    ).toBe(1);
  });

  test('keeps the first rail item active before the first anchor crossing', () => {
    expect(
      resolveActiveRailIndex(
        {
          scrollTop: 0,
          scrollHeight: 1200,
          clientHeight: 400,
          viewportTop: 0,
        },
        [
          { railIndex: 0, top: 220 },
          { railIndex: 1, top: 360 },
        ],
      ),
    ).toBe(0);
  });

  test('returns null when no rail items are rendered', () => {
    expect(
      resolveActiveRailIndex(
        {
          scrollTop: 0,
          scrollHeight: 0,
          clientHeight: 0,
          viewportTop: 0,
        },
        [],
      ),
    ).toBeNull();
  });
});
