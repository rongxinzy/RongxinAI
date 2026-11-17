import { MODE_FRAMES, type ModeFrame } from 'thinking-orbs/engine';

// Keep the entire sphere visible instead of dimming all but a scanning meridian.
export const ROUND_GLOBE_OPTIONS = { dimBase: 1, rBoost: 0 } as const;

// Match the library's reduced-motion pose so stopped and reduced-motion
// indicators share one complete silhouette, independent of wall-clock phase.
const settledFrameTime = 0.6;

export const settledThinkingFrame: ModeFrame = (size, _time, options) =>
  MODE_FRAMES.globe(size, settledFrameTime, { ...options, ...ROUND_GLOBE_OPTIONS });
