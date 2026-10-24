/** Source rectangles only; the generated transparent image is preserved byte-for-byte. */
export const OWL_RIG_FRAMES = {
  body: [82, 133, 252, 238],
  head: [433, 114, 280, 249],
  leftWing: [783, 134, 221, 239],
  rightWing: [1175, 136, 224, 237],
  leftFoot: [117, 518, 167, 143],
  rightFoot: [482, 518, 165, 144],
  tail: [776, 476, 250, 199],
  scarf: [1145, 482, 243, 196],
  face: [73, 809, 266, 157],
  blink: [426, 820, 262, 139],
  happy: [771, 810, 254, 157],
  worried: [1122, 808, 259, 155],
};

/** Offline artwork renderer. Self-contained so the exact function runs in Chromium. */
export function drawOwlRig(context, image, frames, pose) {
  const part = (name, x, y, width, height, angle = 0, pivotX = 0.5, pivotY = 0.5) => {
    const [sx, sy, sw, sh] = frames[name];
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.drawImage(image, sx, sy, sw, sh, -width * pivotX, -height * pivotY, width, height);
    context.restore();
  };
  context.clearRect(0, 0, 512, 512);
  context.save();
  context.translate(256 + pose.x, 452 + pose.y);
  context.rotate(pose.lean);
  context.scale(1 / Math.sqrt(pose.stretch), pose.stretch);
  context.translate(-256, -452);
  part('tail', 256 + pose.tail * 8, 410, 105, 84, pose.tail);
  part('leftFoot', 222 + pose.leftFootX, 450 + pose.leftFootY, 39, 34, pose.leftFootAngle);
  part('rightFoot', 290 + pose.rightFootX, 450 + pose.rightFootY, 39, 34, pose.rightFootAngle);
  part('body', 256, 346, 202, 191);
  const leftWing = () =>
    part(
      'leftWing',
      180,
      315,
      106 * pose.leftWingScale,
      115 * pose.leftWingScale,
      pose.leftWing,
      0.8,
      0.16,
    );
  const rightWing = () =>
    part(
      'rightWing',
      332,
      315,
      108 * pose.rightWingScale,
      114 * pose.rightWingScale,
      pose.rightWing,
      0.2,
      0.16,
    );
  if (!pose.leftWingFront) leftWing();
  if (!pose.rightWingFront) rightWing();
  context.save();
  context.translate(256 + pose.headX, 306 + pose.headY);
  context.rotate(pose.headAngle);
  context.scale(pose.headScaleX, 1);
  part('head', 0, -93, 266, 237);
  context.globalAlpha = 1 - pose.blink;
  part(pose.face, pose.faceX, -66, 205, 121);
  context.globalAlpha = pose.blink;
  part('blink', pose.faceX, -66, 205, 121);
  context.globalAlpha = 1;
  context.restore();
  if (pose.leftWingFront) leftWing();
  if (pose.rightWingFront) rightWing();
  part('scarf', 256, 320, 240, 110, pose.scarf, 0.5, 0.19);
  context.restore();
}
