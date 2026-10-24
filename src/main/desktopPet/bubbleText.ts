import { DesktopPetState } from '../../shared/desktopPet/constants';

const BUBBLE_STATES = new Set<DesktopPetState>([
  DesktopPetState.Thinking,
  DesktopPetState.Waiting,
  DesktopPetState.Completed,
  DesktopPetState.Error,
]);

export function desktopPetShowsBubble(state: DesktopPetState): boolean {
  return BUBBLE_STATES.has(state);
}

export function desktopPetBubbleKey(state: DesktopPetState): string | null {
  if (!BUBBLE_STATES.has(state)) return null;
  return `desktopPet_bubble_${state}`;
}
