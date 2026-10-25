export const CompanionBubbleSide = { Above: 'above', Below: 'below' } as const;
export type CompanionBubbleSide = (typeof CompanionBubbleSide)[keyof typeof CompanionBubbleSide];
export interface CompanionBubblePlacement {
  side: CompanionBubbleSide;
  anchorX: number;
}
