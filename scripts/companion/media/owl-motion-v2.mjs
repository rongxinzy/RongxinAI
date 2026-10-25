/** First quality study: a grounded idle, one quick blink and a small attentive head turn. */
export function sampleOwlMotionV2(id, seconds, duration, clips) {
  const t = Math.max(0, Math.min(duration, seconds));
  const p = t / duration;
  const phase = p * Math.PI * 2;
  const smooth = value => {
    const x = Math.max(0, Math.min(1, value));
    return x * x * (3 - 2 * x);
  };
  const blinkAt = duration * 0.38;
  const blinkTime = t - blinkAt;
  const blink =
    blinkTime < 0 || blinkTime > 0.17
      ? 0
      : blinkTime < 0.055
        ? smooth(blinkTime / 0.055)
        : blinkTime < 0.085
          ? 1
          : 1 - smooth((blinkTime - 0.085) / 0.085);
  const turn = smooth((p - 0.52) / 0.12) * (1 - smooth((p - 0.78) / 0.18));
  return {
    x: 0,
    y: 0,
    stretch: 1 + Math.sin(phase) * 0.004,
    headX: turn * -2.5,
    headY: -Math.sin(phase) * 0.5,
    headAngle: turn * -0.035,
    leftWing: Math.sin(phase - 0.3) * 0.006,
    rightWing: -Math.sin(phase - 0.3) * 0.006,
    scarf: Math.sin(phase - 0.65) * 0.004 - turn * 0.006,
    face: 'face',
    blink,
  };
}
