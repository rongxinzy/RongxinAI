/** Offline bitmap-joint composition; every visible part comes from the authored source. */
export function drawCompanionRig(context, image, frames, pose, rig) {
  const part = (name, x, y, width, height, angle = 0, pivotX = 0.5, pivotY = 0.5) => {
    const source = frames[name];
    if (!source) return;
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.drawImage(image, ...source, -width * pivotX, -height * pivotY, width, height);
    context.restore();
  };
  context.clearRect(0, 0, 512, 512);
  context.save();
  context.translate(256 + pose.x, 452 + pose.y);
  context.rotate(pose.lean);
  context.scale(1 / Math.sqrt(pose.stretch), pose.stretch);
  context.translate(-256, -452);
  const [tx, ty, tw, th, tpx, tpy] = rig.tail;
  part('tail', tx, ty, tw, th, pose.tail, tpx, tpy);
  if (rig.wings) {
    const [x, y, width, height] = rig.wings;
    part('leftWing', x, y, width, height, pose.leftWing, 0.88, 0.72);
    part('rightWing', 512 - x, y, width, height, pose.rightWing, 0.12, 0.72);
  }
  const [fx, fy, fw, fh] = rig.feet;
  part('leftFoot', fx + pose.leftFootX, fy + pose.leftFootY, fw, fh, pose.leftFootAngle, 0.5, 0.85);
  part(
    'rightFoot',
    512 - fx + pose.rightFootX,
    fy + pose.rightFootY,
    fw,
    fh,
    pose.rightFootAngle,
    0.5,
    0.85,
  );
  part('body', ...rig.body);
  const [ax, ay, aw, ah] = rig.arms;
  const arm = left => {
    const index = left ? 0 : 1;
    const [px, py] = rig.armPivots[index];
    const [tipX, tipY] = rig.armTips[index];
    const rest = Math.atan2((tipX - px) * aw, (tipY - py) * ah);
    part(
      left ? 'leftArm' : 'rightArm',
      left ? ax : 512 - ax,
      ay,
      aw * (left ? pose.leftArmScale : pose.rightArmScale),
      ah * (left ? pose.leftArmScale : pose.rightArmScale),
      rest + (left ? pose.leftArm : pose.rightArm),
      px,
      py,
    );
  };
  if (!pose.leftArmFront) arm(true);
  if (!pose.rightArmFront) arm(false);
  const [hx, hy, hw, hh] = rig.head;
  context.save();
  context.translate(hx + pose.headX, hy + pose.headY);
  context.rotate(pose.headAngle);
  context.scale(pose.headScaleX, 1);
  const [ex, ey, ew, eh, epy] = rig.ears;
  part('leftEar', -ex, ey, ew, eh, pose.leftEar, 0.5, epy);
  part('rightEar', ex, ey, ew, eh, pose.rightEar, 0.5, epy);
  part('head', 0, 0, hw, hh);
  const [px, py, pw, ph] = rig.face;
  if (pose.blink <= 0) part(pose.face, px + pose.faceX, py, pw, ph);
  else {
    const feature = (name, from, to) => {
      const [sx, sy, sw, sh] = frames[name];
      context.drawImage(
        image,
        sx,
        sy + sh * from,
        sw,
        sh * (to - from),
        px + pose.faceX - pw / 2,
        py - ph / 2 + ph * from,
        pw,
        ph * (to - from),
      );
    };
    const [from, to] = rig.eyeBand;
    feature(pose.face, 0, from);
    feature(pose.face, to, 1);
    if (pose.blink >= 0.98) feature('blink', from, to);
    else {
      // One eye band closes toward the authored lid line; never overlay two pairs of eyes.
      const [sx, sy, sw, sh] = frames[pose.face];
      const height = ph * (to - from) * (1 - pose.blink);
      const center = ((from + to) / 2) * (1 - pose.blink) + 0.55 * pose.blink;
      context.drawImage(
        image,
        sx,
        sy + sh * from,
        sw,
        sh * (to - from),
        px + pose.faceX - pw / 2,
        py - ph / 2 + ph * center - height / 2,
        pw,
        height,
      );
    }
  }
  context.restore();
  part('bandana', ...rig.bandana, pose.bandana, 0.5, 0.12);
  if (pose.leftArmFront) arm(true);
  if (pose.rightArmFront) arm(false);
  context.restore();
}
