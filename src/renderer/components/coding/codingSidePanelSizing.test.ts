import { describe, expect, test } from 'vitest';

import {
  CODING_SIDE_PANEL_MAX_CONTENT_RATIO,
  resolveCodingSidePanelMaxWidth,
} from './codingSidePanelSizing';

describe('coding side panel sizing', () => {
  test('allows the coding side panel slightly more than half of the workbench', () => {
    expect(resolveCodingSidePanelMaxWidth(2000, 280)).toBe(
      2000 * CODING_SIDE_PANEL_MAX_CONTENT_RATIO,
    );
  });

  test('preserves the conversation reserve on narrower workbenches', () => {
    expect(resolveCodingSidePanelMaxWidth(700, 280)).toBe(340);
    expect(resolveCodingSidePanelMaxWidth(500, 280)).toBe(280);
  });
});
