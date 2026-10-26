/** Time-driven joints; the same sampler is executed offline in Chromium and in seam tests. */
export function sampleCompanionMotion(id, seconds, duration, clips, rig, characters) {
  const progress = Math.max(0, Math.min(1, seconds / duration));
  const phase = progress * Math.PI * 2;
  const envelope = Math.sin(progress * Math.PI) ** 2;
  const lidProgress = Math.min(1, envelope * 6);
  const relaxedBlink = lidProgress * lidProgress * (3 - 2 * lidProgress);
  const wave = Math.sin(phase);
  const energy = rig.energy;
  const pose = {
    x: 0,
    y: -wave * 1.4,
    lean: 0,
    stretch: 1 + wave * 0.004,
    headX: 0,
    headY: -Math.sin(phase - 0.2) * 0.7,
    headAngle: wave * 0.012,
    headScaleX: 1,
    faceX: 0,
    face: 'face',
    blink: Math.max(0, 1 - Math.abs(progress - 0.72) / 0.025),
    leftArm: wave * 0.015,
    rightArm: -wave * 0.015,
    leftArmScale: 1,
    rightArmScale: 1,
    leftArmFront: false,
    rightArmFront: false,
    leftFootX: 0,
    leftFootY: 0,
    leftFootAngle: 0,
    rightFootX: 0,
    rightFootY: 0,
    rightFootAngle: 0,
    leftEar: Math.sin(phase - 0.4) * 0.025,
    rightEar: -Math.sin(phase - 0.4) * 0.025,
    leftWing: wave * 0.035,
    rightWing: -wave * 0.035,
    tail: Math.sin(phase - 0.3) * rig.tailSwing,
    bandana: Math.sin(phase - 0.55) * 0.012,
  };
  switch (id) {
    case clips.Blink:
      pose.blink = Math.max(0, 1 - Math.abs(progress - 0.4) / 0.045);
      pose.headY += envelope * 2;
      break;
    case clips.LookLeft:
    case clips.LookRight: {
      const direction = id === clips.LookLeft ? -1 : 1;
      pose.headX = direction * envelope * 6;
      pose.headAngle = direction * envelope * 0.1;
      pose.headScaleX = 1 - envelope * 0.035;
      pose.faceX = direction * envelope * 5;
      pose.tail -= direction * envelope * 0.09;
      break;
    }
    case clips.Tilt:
      pose.headAngle = wave * envelope * 0.22;
      pose.leftEar -= envelope * 0.08;
      pose.rightEar += envelope * 0.04;
      break;
    case clips.Nod:
      pose.headY += Math.sin(progress * Math.PI * 6) * envelope * 8;
      pose.headAngle += envelope * 0.04;
      pose.leftArm -= envelope * 0.06;
      break;
    case clips.Peek:
      pose.x = envelope * 10;
      pose.lean = envelope * 0.06;
      pose.headX = envelope * 9;
      pose.headAngle = -envelope * 0.17;
      pose.faceX = envelope * 4;
      if (rig.id === characters.Youli) pose.tail -= envelope * 0.3;
      if (rig.id === characters.Tuantuan) {
        pose.leftArm = -envelope * 0.7;
        pose.rightArm = envelope * 0.7;
        pose.leftArmFront = pose.rightArmFront = true;
        pose.headY += envelope * 3;
      }
      if (rig.id === characters.Zhuli) {
        pose.headAngle *= 0.6;
        pose.tail += envelope * 0.24;
        pose.leftArm -= envelope * 0.4;
      }
      if (rig.id === characters.Mianmian) {
        pose.leftEar -= envelope * 0.2;
        pose.rightEar -= envelope * 0.09;
      }
      if (rig.id === characters.Maixiao) {
        pose.leftFootY = -envelope * 9;
        pose.tail += Math.sin(phase * 4) * envelope * 0.3;
      }
      if (rig.wings) pose.leftWing -= envelope * 0.2;
      break;
    case clips.Flutter:
      pose.leftArm = envelope * 1.1;
      pose.rightArm = -envelope * 1.1;
      pose.headY -= envelope * 4;
      pose.leftEar -= envelope * 0.1;
      pose.rightEar += envelope * 0.1;
      pose.leftWing = -envelope * (0.6 + Math.sin(phase * 4) * 0.25);
      pose.rightWing = -pose.leftWing;
      pose.stretch += envelope * 0.025;
      break;
    case clips.Happy:
      pose.face = 'happy';
      pose.blink = 0;
      pose.y -= envelope * Math.max(0, Math.sin(phase * 4)) ** 2 * 15 * energy;
      pose.leftArm = envelope * 2.15;
      pose.rightArm = -envelope * 2.15;
      pose.leftArmFront = pose.rightArmFront = true;
      pose.tail += Math.sin(phase * 3) * envelope * rig.tailSwing;
      pose.headAngle += envelope * wave * 0.06;
      break;
    case clips.Stretch:
      pose.stretch += envelope * 0.055;
      pose.leftArm = envelope * 2.6;
      pose.rightArm = -envelope * 2.6;
      pose.leftArmFront = pose.rightArmFront = true;
      pose.headY -= envelope * 7;
      pose.blink = relaxedBlink;
      pose.leftWing -= envelope * 0.5;
      pose.rightWing += envelope * 0.5;
      break;
    case clips.Doze:
    case clips.Wake: {
      const step = Math.min(1, progress * 3);
      const ease = step * step * (3 - 2 * step);
      const rest = id === clips.Doze ? ease : 1 - ease;
      pose.blink = rest + (1 - rest) * pose.blink;
      pose.y += rest * 7;
      pose.headY += rest * 11;
      pose.headAngle += rest * 0.13;
      pose.leftArm -= rest * 0.65;
      pose.rightArm += rest * 0.65;
      pose.leftArmFront = pose.rightArmFront = rest > 0;
      pose.leftEar += rest * 0.08;
      pose.rightEar -= rest * 0.08;
      if (id === clips.Wake) {
        pose.leftArm -= envelope * 0.65;
        pose.rightArm += envelope * 0.65;
        pose.headY -= envelope * 4;
      }
      break;
    }
    case clips.Think:
      pose.headAngle += 0.1;
      pose.headX -= 3;
      pose.leftArm = -2.45 + wave * 0.025;
      pose.leftArmScale = 0.84;
      pose.leftArmFront = true;
      pose.faceX = -3;
      break;
    case clips.Wait:
      pose.leftArm = -0.65 + wave * 0.015;
      pose.rightArm = 0.65 - wave * 0.015;
      pose.leftArmScale = pose.rightArmScale = 0.92;
      pose.leftArmFront = pose.rightArmFront = true;
      pose.headY += 3;
      pose.headAngle += 0.04;
      break;
    case clips.Concern:
      pose.face = 'worried';
      pose.headY += 7;
      pose.headAngle -= 0.08;
      pose.leftArm -= 0.18;
      pose.rightArm += 0.18;
      pose.tail *= 0.35;
      break;
    case clips.Wave:
      pose.rightArm = -envelope * (2.2 + Math.sin(phase * 5) * 0.22);
      pose.rightArmFront = true;
      pose.headAngle -= envelope * 0.09;
      pose.face = 'happy';
      pose.blink = 0;
      break;
    case clips.Walk: {
      const stride = Math.sin(phase * rig.walkCycles);
      pose.leftFootX = stride * 8 * energy;
      pose.rightFootX = -stride * 8 * energy;
      pose.leftFootY = -(Math.max(0, stride) ** 2) * 13 * energy;
      pose.rightFootY = -(Math.max(0, -stride) ** 2) * 13 * energy;
      pose.y -= stride ** 2 * 2;
      pose.lean = stride * 0.016;
      pose.headAngle = -stride * 0.02;
      pose.leftArm = stride * 0.09;
      pose.rightArm = -stride * 0.09;
      pose.leftEar -= stride * 0.03;
      pose.rightEar -= stride * 0.03;
      break;
    }
    case clips.Lift:
      pose.leftArm = 0.4 + wave * 0.04;
      pose.rightArm = -0.4 - wave * 0.04;
      pose.leftFootY = 3 + wave;
      pose.rightFootY = 3 - wave;
      pose.leftFootAngle = 0.12;
      pose.rightFootAngle = -0.12;
      pose.headAngle = wave * 0.05;
      break;
    case clips.Land:
      pose.stretch -= envelope * 0.06;
      pose.headY += envelope * 6;
      pose.leftArm += envelope * 0.4;
      pose.rightArm -= envelope * 0.4;
      pose.leftEar += envelope * 0.13;
      pose.rightEar -= envelope * 0.13;
      break;
    case clips.Listen:
      pose.headAngle = envelope * (0.13 + wave * 0.04);
      pose.headY -= envelope * 3;
      pose.faceX = envelope * 3;
      pose.leftEar -= envelope * 0.16;
      pose.rightEar += envelope * 0.04;
      break;
    case clips.Bow:
      pose.headY += envelope * 14;
      pose.headAngle += envelope * 0.13;
      pose.y += envelope * 3;
      pose.blink = relaxedBlink;
      pose.leftArm -= envelope * 0.4;
      pose.rightArm += envelope * 0.4;
      break;
    case clips.Preen:
      pose.headX -= envelope * 6;
      pose.headAngle -= envelope * 0.22;
      pose.leftArm = -envelope * (2.4 + Math.sin(phase * 3) * 0.1);
      pose.leftArmFront = true;
      pose.blink = relaxedBlink;
      if (rig.id === characters.Tuantuan) {
        pose.rightArm = -pose.leftArm;
        pose.rightArmFront = true;
        pose.headX = 0;
        pose.headAngle = envelope * wave * 0.05;
      }
      if (rig.id === characters.Mianmian) pose.leftEar -= envelope * 0.25;
      if (rig.id === characters.Zhuli) pose.tail -= envelope * 0.32;
      if (rig.id === characters.Youli) pose.tail += envelope * 0.24;
      if (rig.wings) pose.leftWing -= envelope * 0.6;
      if (rig.id === characters.Maixiao) {
        pose.rightArm = envelope * (2.5 + Math.sin(phase * 4) * 0.13);
        pose.leftArm = 0;
        pose.rightArmFront = true;
        pose.headAngle *= -1;
      }
      break;
    case clips.Hop:
      pose.y -= envelope * 32 * energy;
      pose.stretch += envelope * 0.035;
      pose.leftArm += envelope * 0.8;
      pose.rightArm -= envelope * 0.8;
      pose.leftFootY = pose.rightFootY = -envelope * 5;
      pose.leftEar += envelope * 0.12;
      pose.rightEar -= envelope * 0.12;
      break;
    case clips.Dance: {
      const beat = Math.sin(phase * (rig.id === characters.Maixiao ? 8 : 5)) * envelope;
      pose.x = beat * 6 * energy;
      pose.lean = beat * 0.04;
      pose.headAngle = -beat * 0.1;
      pose.leftArm = envelope * 1.1 - beat * 0.2;
      pose.rightArm = -envelope * 1.1 - beat * 0.2;
      pose.leftArmFront = pose.rightArmFront = true;
      pose.leftFootY = -(Math.max(0, beat) ** 2) * 12;
      pose.rightFootY = -(Math.max(0, -beat) ** 2) * 12;
      pose.face = 'happy';
      pose.blink = 0;
      if (rig.id === characters.Mianmian) {
        pose.y -= beat ** 2 * 12;
        pose.leftEar += beat * 0.18;
        pose.rightEar += beat * 0.18;
      }
      if (rig.id === characters.Tuantuan) {
        pose.leftArm = -envelope * (0.8 + beat * 0.15);
        pose.rightArm = -pose.leftArm;
        pose.headY += envelope * 2;
      }
      if (rig.id === characters.Zhuli) {
        pose.leftArm = -envelope * 0.65;
        pose.rightArm = envelope * 0.65;
        pose.leftArmScale = pose.rightArmScale = 0.9;
        pose.tail -= envelope * 0.2;
        pose.headAngle = -beat * 0.05;
      }
      if (rig.id === characters.Youli) {
        pose.tail += beat * 0.25;
        pose.headAngle = -beat * 0.15;
      }
      if (rig.wings) {
        pose.leftWing -= beat * 0.4;
        pose.rightWing += beat * 0.4;
        pose.y -= beat ** 2 * 7;
        pose.leftArm = envelope * 0.5;
        pose.rightArm = -envelope * 0.5;
      }
      pose.tail += Math.sin(phase * 3) * envelope * rig.tailSwing;
      break;
    }
  }
  pose.bandana -= pose.headAngle * 0.07 + pose.lean * 0.15;
  pose.tail -= pose.lean * 0.3;
  return pose;
}
