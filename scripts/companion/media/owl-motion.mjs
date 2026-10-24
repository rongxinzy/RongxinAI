/** Authored joint choreography; no interpolation between whole-character pose images. */
export function sampleOwlMotion(id, seconds, duration, clips) {
  const progress = Math.max(0, Math.min(1, seconds / duration));
  const phase = progress * Math.PI * 2;
  const envelope = Math.sin(progress * Math.PI) ** 2;
  const wave = Math.sin(phase);
  const pose = {
    x: 0,
    y: -Math.sin(phase) * 1.5,
    stretch: 1 + Math.sin(phase) * 0.006,
    lean: 0,
    headX: 0,
    headY: -Math.sin(phase + 0.25) * 0.6,
    headAngle: wave * 0.012,
    headScaleX: 1,
    faceX: 0,
    face: 'face',
    blink: Math.max(0, 1 - Math.abs(progress - 0.72) / 0.025),
    leftWing: wave * 0.018,
    rightWing: -wave * 0.018,
    leftWingScale: 1,
    rightWingScale: 1,
    leftWingFront: false,
    rightWingFront: false,
    leftFootX: 0,
    leftFootY: 0,
    leftFootAngle: 0,
    rightFootX: 0,
    rightFootY: 0,
    rightFootAngle: 0,
    tail: Math.sin(phase - 0.3) * 0.025,
    scarf: Math.sin(phase - 0.55) * 0.012,
  };
  switch (id) {
    case clips.Blink:
      pose.blink = Math.max(0, 1 - Math.abs(progress - 0.4) / 0.045);
      pose.headY += envelope * 2;
      break;
    case clips.LookLeft:
    case clips.LookRight: {
      const direction = id === clips.LookLeft ? -1 : 1;
      pose.headX = direction * envelope * 7;
      pose.headAngle = direction * envelope * 0.1;
      pose.faceX = direction * envelope * 6;
      pose.headScaleX = 1 - envelope * 0.035;
      break;
    }
    case clips.Tilt:
      pose.headAngle = Math.sin(phase) * envelope * 0.25;
      pose.headY += envelope * 3;
      break;
    case clips.Nod:
      pose.headY += Math.sin(progress * Math.PI * 6) * envelope * 9;
      pose.headAngle = envelope * 0.06;
      pose.leftWing += envelope * 0.08;
      break;
    case clips.Peek:
      pose.x = envelope * 12;
      pose.lean = envelope * 0.07;
      pose.headX = envelope * 12;
      pose.headAngle = -envelope * 0.18;
      pose.faceX = envelope * 5;
      pose.rightWing = -envelope * 0.55;
      break;
    case clips.Flutter:
      pose.leftWing = envelope * (1 + 0.4 * Math.sin(progress * Math.PI * 12));
      pose.rightWing = -pose.leftWing;
      pose.headY -= envelope * 4;
      pose.stretch += envelope * 0.025;
      pose.face = 'happy';
      pose.blink = 0;
      break;
    case clips.Happy:
      pose.face = 'happy';
      pose.blink = 0;
      pose.y -= envelope * Math.max(0, Math.sin(progress * Math.PI * 8)) * 18;
      pose.leftWing = envelope * 1.2;
      pose.rightWing = -envelope * 1.2;
      pose.headAngle = envelope * wave * 0.1;
      break;
    case clips.Stretch:
      pose.stretch += envelope * 0.075;
      pose.headY -= envelope * 6;
      pose.leftWing = envelope * 1.65;
      pose.rightWing = -pose.leftWing;
      pose.blink = envelope;
      break;
    case clips.Doze: {
      const settle = Math.min(1, progress * 3);
      const rest = settle * settle * (3 - 2 * settle);
      pose.blink = rest;
      pose.y += rest * 8;
      pose.headY += rest * 10;
      pose.headAngle = rest * 0.14;
      pose.leftWing = -rest * 0.1;
      pose.rightWing = rest * 0.1;
      break;
    }
    case clips.Wake: {
      const settle = Math.min(1, progress * 3);
      const rest = 1 - settle * settle * (3 - 2 * settle);
      pose.blink = rest;
      pose.y += rest * 8;
      pose.headY += rest * 10;
      pose.headAngle += rest * 0.14;
      pose.headY -= envelope * 4;
      pose.headAngle += Math.sin(progress * Math.PI * 8) * envelope * 0.09;
      pose.leftWing = -rest * 0.1 + envelope * 0.65;
      pose.rightWing = -pose.leftWing;
      break;
    }
    case clips.Think:
      pose.headAngle += 0.1;
      pose.headX -= 3;
      pose.leftWing += 3.7 + wave * 0.025;
      pose.leftWingScale = 0.7;
      pose.leftWingFront = true;
      pose.faceX = -3;
      break;
    case clips.Wait:
      pose.leftWing = 3.75 + wave * 0.015;
      pose.rightWing = -3.75 - wave * 0.015;
      pose.leftWingScale = pose.rightWingScale = 0.65;
      pose.leftWingFront = pose.rightWingFront = true;
      pose.headY += 3;
      pose.headAngle += 0.06;
      break;
    case clips.Concern:
      pose.face = 'worried';
      pose.headY += 7;
      pose.headAngle += -0.1;
      pose.leftWing = -0.1;
      pose.rightWing = 0.1;
      break;
    case clips.Wave:
      pose.rightWing = -envelope * (1.1 + 0.35 * Math.sin(progress * Math.PI * 10));
      pose.headAngle = -envelope * 0.09;
      pose.face = 'happy';
      pose.blink = 0;
      break;
    case clips.Walk: {
      const stride = Math.sin(phase * 4);
      pose.leftFootX = stride * 9;
      pose.rightFootX = -stride * 9;
      pose.leftFootY = -Math.max(0, stride) * 14;
      pose.rightFootY = -Math.max(0, -stride) * 14;
      pose.y -= Math.abs(stride) * 3;
      pose.lean = stride * 0.018;
      pose.headAngle = -stride * 0.025;
      pose.leftWing = stride * 0.06;
      pose.rightWing = -stride * 0.06;
      break;
    }
    case clips.Lift:
      pose.leftWing = 0.55 + wave * 0.05;
      pose.rightWing = -0.55 - wave * 0.05;
      pose.leftFootAngle = 0.15;
      pose.rightFootAngle = -0.15;
      pose.leftFootY = 3 + wave;
      pose.rightFootY = 3 - wave;
      pose.headAngle = wave * 0.06;
      break;
    case clips.Land:
      pose.stretch -= envelope * 0.075;
      pose.headY += envelope * 7;
      pose.leftWing = envelope * 0.35;
      pose.rightWing = -pose.leftWing;
      break;
    case clips.Listen:
      pose.headAngle = envelope * (0.15 + 0.05 * wave);
      pose.faceX = envelope * 3;
      pose.headY -= envelope * 3;
      pose.rightWing = -envelope * 0.12;
      break;
    case clips.Bow:
      pose.headY += envelope * 16;
      pose.headAngle = envelope * 0.16;
      pose.y += envelope * 3;
      pose.leftWing = -envelope * 0.15;
      pose.rightWing = envelope * 0.15;
      pose.blink = envelope;
      break;
    case clips.Preen:
      pose.headX = -envelope * 10;
      pose.headAngle = -envelope * 0.3;
      pose.leftWing = envelope * (1.6 + Math.sin(phase * 3) * 0.08);
      pose.blink = envelope;
      break;
    case clips.Hop:
      pose.y -= envelope * 40;
      pose.leftWing = envelope * 0.55;
      pose.rightWing = -pose.leftWing;
      pose.leftFootY = -envelope * 5;
      pose.rightFootY = -envelope * 5;
      pose.leftFootAngle = envelope * 0.12;
      pose.rightFootAngle = -envelope * 0.12;
      pose.stretch += envelope * 0.04;
      break;
    case clips.Dance: {
      const beat = Math.sin(progress * Math.PI * 12) * envelope;
      pose.headAngle = -beat * 0.12;
      pose.lean = beat * 0.05;
      pose.leftWing = envelope * 0.6 + beat * 0.25;
      pose.rightWing = -envelope * 0.6 + beat * 0.25;
      pose.leftFootY = -Math.max(0, beat) * 12;
      pose.rightFootY = -Math.max(0, -beat) * 12;
      pose.face = 'happy';
      pose.blink = 0;
      break;
    }
  }
  pose.scarf += -pose.headAngle * 0.08 - pose.lean * 0.2;
  pose.tail += -pose.lean * 0.35;
  return pose;
}
