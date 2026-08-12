export const LayeredTabsSeparatorEdge = {
  Top: 'top',
  Bottom: 'bottom',
} as const;

export type LayeredTabsSeparatorEdge =
  (typeof LayeredTabsSeparatorEdge)[keyof typeof LayeredTabsSeparatorEdge];
