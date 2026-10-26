export const CompanionBubbleSide = { Above: 'above', Below: 'below' } as const;
export type CompanionBubbleSide = (typeof CompanionBubbleSide)[keyof typeof CompanionBubbleSide];
export const COMPANION_BUBBLE_ART_WIDTH = 480;
export interface CompanionBubblePlacement {
  side: CompanionBubbleSide;
  /** Horizontal position in the frame artwork's viewBox, independent of window DIP width. */
  anchorX: number;
}
