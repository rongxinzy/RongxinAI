/** Original first-release pixels only: neutral pose and the original happy pose's closed eyes. */
export const OWL_RIG_V2_FRAMES = {
  head: [0, 0, 512, 286],
  body: [0, 277, 512, 183],
  feet: [0, 458, 512, 54],
  leftEye: [155, 642, 103, 90],
  rightEye: [289, 636, 102, 90],
};

/** Offline puppet renderer; source image is neither redrawn nor recompressed. */
export function drawOwlRigV2(context, image, frames, pose) {
  const piece = (name, dx, dy, dw, dh) => {
    const [sx, sy, sw, sh] = frames[name];
    context.drawImage(image, sx, sy, sw, sh, dx, dy, dw ?? sw, dh ?? sh);
  };
  // Reuse two feathered eye patches. Nothing is read back or allocated on later frames.
  let eyelids = image.owlStudyEyelids;
  if (!eyelids) {
    eyelids = ['leftEye', 'rightEye'].map(name => {
      const [sx, sy, sw, sh] = frames[name];
      const canvas = context.canvas.ownerDocument.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const patch = canvas.getContext('2d');
      patch.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
      patch.globalCompositeOperation = 'destination-in';
      patch.translate(sw / 2, sh / 2);
      patch.scale(sw / 2, sh / 2);
      const fade = patch.createRadialGradient(0, 0, 0, 0, 0, 1);
      fade.addColorStop(0, '#fff');
      fade.addColorStop(0.88, '#fff');
      fade.addColorStop(1, 'transparent');
      patch.fillStyle = fade;
      patch.fillRect(-1, -1, 2, 2);
      return canvas;
    });
    image.owlStudyEyelids = eyelids;
  }
  context.clearRect(0, 0, 512, 512);
  // The original toes do not slide or scale with breathing.
  piece('feet', 0, 458);
  context.save();
  context.translate(256, 460);
  context.scale(1, pose.stretch);
  context.translate(-256, -460);
  piece('body', 0, 277);
  context.restore();
  context.save();
  context.translate(256 + pose.headX, 284 + pose.headY);
  context.rotate(pose.headAngle);
  context.translate(-256, -284);
  piece('head', 0, 0);
  if (pose.blink > 0) {
    // Eye patches may feather toward the nose; the canonical beak is never painted over.
    context.beginPath();
    context.rect(0, 0, 512, 512);
    context.rect(243, 205, 46, 61);
    context.clip('evenodd');
    context.globalAlpha = pose.blink;
    context.drawImage(eyelids[0], 155, 143, 103, 104);
    context.drawImage(eyelids[1], 279, 153, 102, 106);
  }
  context.restore();
}
