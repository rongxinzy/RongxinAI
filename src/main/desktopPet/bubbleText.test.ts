import { test, expect } from 'vitest';

import { DesktopPetState } from '../../shared/desktopPet/constants';
import { desktopPetBubbleKey, desktopPetShowsBubble } from './bubbleText';

test('bubble copy is limited to active task states', () => {
  expect(desktopPetShowsBubble(DesktopPetState.Waiting)).toBe(true);
  expect(desktopPetShowsBubble(DesktopPetState.Idle)).toBe(false);
  expect(desktopPetBubbleKey(DesktopPetState.Error)).toBe('desktopPet_bubble_error');
  expect(desktopPetBubbleKey(DesktopPetState.Greeting)).toBeNull();
});
