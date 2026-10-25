/** Staged gestures: notice, anticipate, perform, hold, recover. First-release face throughout. */
export function sampleOriginalOwl(id, seconds, duration, clips) {
  const p = Math.max(0, Math.min(1, seconds / duration));
  const smooth = n => {
    const t = Math.max(0, Math.min(1, n));
    return t * t * (3 - 2 * t);
  };
  const hold = (start, rise, fall, end) =>
    smooth((p - start) / (rise - start)) * (1 - smooth((p - fall) / (end - fall)));
  const beat = (start, end) =>
    Math.sin(Math.PI * Math.max(0, Math.min(1, (p - start) / (end - start)))) ** 2;
  const pulse = Math.sin(p * Math.PI * 2);
  const main = hold(0.12, 0.3, 0.68, 0.94);
  const blinkAt = duration * 0.38;
  const bt = Math.max(0, seconds) - blinkAt;
  const blink =
    bt < 0 || bt > 0.17
      ? 0
      : bt < 0.055
        ? smooth(bt / 0.055)
        : bt < 0.085
          ? 1
          : 1 - smooth((bt - 0.085) / 0.085);
  const pose = {
    cell: 0,
    x: 0,
    y: 0,
    lean: 0,
    stretch: 1 + pulse * 0.004,
    headX: 0,
    headY: -pulse * 0.5,
    headAngle: 0,
    leftWing: 0,
    rightWing: 0,
    scarf: 0,
    blink,
    leftFootX: 0,
    rightFootX: 0,
    leftFootY: 0,
    rightFootY: 0,
    leftFootAngle: 0,
    rightFootAngle: 0,
  };
  switch (id) {
    case clips.Idle:
      pose.headX = -hold(0.52, 0.64, 0.78, 0.96) * 2.5;
      pose.headAngle = -hold(0.52, 0.64, 0.78, 0.96) * 0.035;
      break;
    case clips.LookLeft:
    case clips.LookRight: {
      const direction = id === clips.LookLeft ? -1 : 1;
      pose.headX = direction * main * 5;
      pose.headAngle = direction * main * 0.09;
      break;
    }
    case clips.Blink:
      pose.headY += beat(0.28, 0.6) * 1.5;
      break;
    case clips.Tilt:
      pose.headAngle = 0.12 * (hold(0.08, 0.24, 0.4, 0.5) - hold(0.5, 0.65, 0.78, 0.95));
      break;
    case clips.Nod:
      pose.headY += (beat(0.22, 0.43) + beat(0.46, 0.67)) * 7;
      pose.headAngle = main * 0.035;
      pose.leftWing = main * 0.045;
      break;
    case clips.Peek:
      pose.headX = main * 7;
      pose.headAngle = -main * 0.1;
      pose.rightWing = -main * 0.32;
      pose.lean = main * 0.015;
      break;
    case clips.Flutter: {
      const flaps = main * (1.35 + 0.3 * Math.sin((p - 0.3) * Math.PI * 10));
      pose.leftWing = flaps;
      pose.rightWing = -flaps;
      pose.headY -= main * 3;
      break;
    }
    case clips.Happy:
      pose.leftWing = main * (1.4 + 0.1 * Math.sin(p * Math.PI * 8));
      pose.rightWing = -pose.leftWing;
      pose.y = -(beat(0.25, 0.42) + beat(0.52, 0.72)) * 13;
      pose.headAngle = main * Math.sin(p * Math.PI * 4) * 0.045;
      pose.blink = Math.max(blink, hold(0.24, 0.265, 0.64, 0.665));
      break;
    case clips.Stretch:
      pose.leftWing = main * 1.58;
      pose.rightWing = -pose.leftWing;
      pose.stretch += main * 0.02;
      pose.blink = Math.max(blink, main);
      break;
    case clips.Doze: {
      const rest = smooth((p - 0.08) / 0.24);
      pose.blink = Math.max(blink, rest);
      pose.headAngle = rest * 0.09;
      pose.headY += rest * 7;
      pose.stretch -= rest * 0.014;
      break;
    }
    case clips.Wake: {
      const rest = 1 - smooth((p - 0.05) / 0.3);
      pose.blink = Math.max(blink, rest);
      pose.headAngle = rest * 0.09 + Math.sin(p * Math.PI * 8) * main * 0.07;
      pose.headY += rest * 7;
      pose.stretch -= rest * 0.014;
      pose.leftWing = main * 0.55;
      pose.rightWing = -pose.leftWing;
      break;
    }
    case clips.Think:
      pose.cell = 1;
      pose.headAngle = pulse * 0.006;
      break;
    case clips.Wait:
      pose.cell = 2;
      pose.headY = pulse * 0.4;
      break;
    case clips.Concern:
      pose.cell = 4;
      pose.headAngle = pulse * 0.004;
      break;
    case clips.Wave:
      pose.rightWing = -main * (1.92 + Math.sin((p - 0.3) * Math.PI * 8) * 0.22);
      pose.headAngle = -main * 0.065;
      pose.headY -= main * 2;
      break;
    case clips.Walk: {
      const step = Math.sin(p * Math.PI * 8);
      pose.leftFootX = step * 4;
      pose.rightFootX = -step * 4;
      pose.leftFootY = -Math.max(0, step) * 7;
      pose.rightFootY = -Math.max(0, -step) * 7;
      pose.y = -Math.abs(step) * 1.5;
      pose.leftWing = step * 0.025;
      pose.rightWing = -pose.leftWing;
      break;
    }
    case clips.Lift:
      pose.leftWing = 0.22 + pulse * 0.03;
      pose.rightWing = -pose.leftWing;
      pose.leftFootAngle = 0.09;
      pose.rightFootAngle = -0.09;
      pose.leftFootY = 2 + pulse;
      pose.rightFootY = 2 - pulse;
      break;
    case clips.Land:
      pose.stretch -= beat(0.08, 0.5) * 0.035;
      pose.leftWing = main * 0.25;
      pose.rightWing = -pose.leftWing;
      pose.headY += beat(0.08, 0.5) * 4;
      break;
    case clips.Listen:
      pose.headAngle = main * 0.12;
      pose.headX = main * 3;
      pose.leftWing = main * 0.09;
      break;
    case clips.Bow:
      pose.headY += main * 9;
      pose.headAngle = main * 0.06;
      pose.blink = Math.max(blink, main);
      pose.leftWing = pose.rightWing = main * 0.04;
      break;
    case clips.Preen:
      pose.headAngle = -main * 0.14;
      pose.headX = -main * 6;
      pose.leftWing = main * (1.8 + 0.04 * Math.sin(p * Math.PI * 8));
      pose.blink = Math.max(blink, main);
      break;
    case clips.Hop:
      pose.y = -beat(0.25, 0.7) * 17;
      pose.leftWing = main * 0.5;
      pose.rightWing = -pose.leftWing;
      pose.leftFootY = pose.rightFootY = -main * 2;
      break;
    case clips.Dance: {
      const sway = main * Math.sin(p * Math.PI * 8);
      pose.headAngle = -sway * 0.055;
      pose.lean = sway * 0.025;
      pose.leftWing = main * 0.5 + sway * 0.15;
      pose.rightWing = -main * 0.5 + sway * 0.15;
      pose.leftFootY = -Math.max(0, sway) * 6;
      pose.rightFootY = -Math.max(0, -sway) * 6;
      break;
    }
  }
  pose.scarf =
    -pose.headAngle * 0.05 +
    (Math.abs(pose.leftWing) + Math.abs(pose.rightWing)) * Math.sin(p * Math.PI * 6 - 0.5) * 0.018;
  return pose;
}
