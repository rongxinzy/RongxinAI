/** First-release facial/foot geometry and explicitly separated occlusion-repair anatomy. */
export const ORIGINAL_OWL_RIG = {
  leftWing: [
    [139, 310],
    [184, 316],
    [218, 339],
    [255, 366],
    [258, 394],
    [245, 420],
    [220, 443],
    [171, 450],
    [130, 445],
    [103, 418],
    [96, 380],
    [111, 337],
  ],
  rightWing: [
    [350, 324],
    [390, 335],
    [425, 363],
    [432, 410],
    [411, 444],
    [360, 457],
    [308, 438],
    [285, 407],
    [283, 370],
    [321, 338],
  ],
  scarf: [
    [326, 276],
    [358, 278],
    [377, 298],
    [393, 321],
    [409, 343],
    [399, 356],
    [370, 362],
    [348, 351],
    [340, 325],
    [334, 301],
  ],
  band: [
    [138, 277],
    [334, 273],
    [357, 289],
    [348, 316],
    [321, 326],
    [170, 325],
    [141, 314],
  ],
  repair: {
    body: [66, 1109, 446, 375],
    leftWing: [647, 1094, 291, 385],
    rightWing: [1129, 1104, 313, 375],
    leftFan: [28, 1519, 480, 450],
    rightFan: [548, 1521, 463, 440],
  },
};

/** Offline puppet; head/face/toes retain original pixels, hidden torso/wings use the repair sheet. */
export function drawOriginalOwl(context, image, geometry, pose) {
  let parts = image.originalOwlParts;
  if (!parts) {
    const make = () => {
      const canvas = context.canvas.ownerDocument.createElement('canvas');
      canvas.width = canvas.height = 512;
      return canvas;
    };
    const polygon = (ctx, points) => {
      ctx.beginPath();
      points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    };
    const part = (points, wing) => {
      const canvas = make(),
        ctx = canvas.getContext('2d');
      polygon(ctx, points);
      ctx.clip();
      ctx.drawImage(image, 0, 0, 512, 512, 0, 0, 512, 512);
      if (wing) {
        ctx.globalCompositeOperation = 'destination-out';
        for (const cloth of [geometry.scarf, geometry.band]) {
          polygon(ctx, cloth);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'destination-over';
        const source = geometry.repair[wing];
        ctx.drawImage(image, ...source, wing === 'leftWing' ? 103 : 301, 312, 150, 145);
      }
      return canvas;
    };
    const body = make(),
      ctx = body.getContext('2d');
    ctx.drawImage(image, 0, 277, 512, 183, 0, 277, 512, 183);
    ctx.globalCompositeOperation = 'destination-out';
    for (const points of [geometry.leftWing, geometry.rightWing, geometry.scarf]) {
      polygon(ctx, points);
      ctx.fill();
    }
    // Fill only anatomy that the folded wings hid. Head/face/toes and the visible
    // compact-wing and scarf pixels are retained from the first-release source.
    ctx.globalCompositeOperation = 'destination-over';
    ctx.drawImage(image, ...geometry.repair.body, 137, 278, 254, 190);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(part(geometry.band), 0, 0);
    const cleanBody = make(),
      clean = cleanBody.getContext('2d');
    clean.drawImage(image, ...geometry.repair.body, 137, 278, 254, 190);
    clean.drawImage(part(geometry.band), 0, 0);
    const repairedLeft = make(),
      repairedRight = make();
    repairedLeft.getContext('2d').drawImage(image, ...geometry.repair.leftWing, 103, 311, 128, 145);
    repairedRight
      .getContext('2d')
      .drawImage(image, ...geometry.repair.rightWing, 302, 312, 128, 145);
    parts = {
      body,
      cleanBody,
      repairedLeft,
      repairedRight,
      leftWing: part(geometry.leftWing, 'leftWing'),
      rightWing: part(geometry.rightWing, 'rightWing'),
      scarf: part(geometry.scarf),
    };
    image.originalOwlParts = parts;
  }
  const drawCell = (index, from, to) => {
    // The source group's happy wing spills into the next error cell. Its isolated
    // fragment is not part of the error character; retain the actual owl from x=80.
    const left = index === 4 ? 80 : 0;
    context.drawImage(
      image,
      (index % 3) * 512 + left,
      Math.floor(index / 3) * 512 + from,
      512 - left,
      to - from,
      left,
      from,
      512 - left,
      to - from,
    );
  };
  const joint = (part, x, y, angle) => {
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.drawImage(part, -x, -y);
    context.restore();
  };
  const wing = (left, angle, repairWeight) => {
    const opening = Math.max(0, Math.min(1, (Math.abs(angle) - 0.6) / 0.65));
    const blend = opening * opening * (3 - 2 * opening);
    const alpha = context.globalAlpha;
    context.globalAlpha = alpha * (1 - blend) * (1 - repairWeight);
    joint(left ? parts.leftWing : parts.rightWing, left ? 166 : 363, left ? 328 : 339, angle);
    context.globalAlpha = alpha * (1 - blend) * repairWeight;
    joint(
      left ? parts.repairedLeft : parts.repairedRight,
      left ? 166 : 363,
      left ? 328 : 339,
      angle,
    );
    if (blend) {
      context.save();
      context.globalAlpha = alpha * blend;
      context.translate(left ? 166 : 363, left ? 328 : 339);
      context.rotate((angle + (left ? -1.5 : 1.6)) * 0.3);
      const width = 154 * (0.68 + blend * 0.32);
      context.drawImage(
        image,
        ...geometry.repair[left ? 'leftFan' : 'rightFan'],
        -width * (left ? 0.86 : 0.14),
        -154 * 0.72,
        width,
        154,
      );
      context.restore();
    }
    context.globalAlpha = alpha;
  };
  context.clearRect(0, 0, 512, 512);
  context.save();
  context.translate(256 + pose.x, 460 + pose.y);
  context.rotate(pose.lean);
  context.scale(1 / Math.sqrt(pose.stretch), pose.stretch);
  context.translate(-256, -460);
  if (pose.cell) {
    // Authored task expressions keep their original object/hand relationship intact.
    drawCell(pose.cell, 277, 512);
  } else {
    const foot = (sx, width, pivot, dx, dy, angle) => {
      context.save();
      context.translate(pivot + dx, 480 + dy);
      context.rotate(angle);
      context.drawImage(image, sx, 458, width, 54, sx - pivot, -22, width, 54);
      context.restore();
    };
    if (
      Math.abs(pose.leftFootX) +
        Math.abs(pose.leftFootY) +
        Math.abs(pose.leftFootAngle) +
        Math.abs(pose.rightFootX) +
        Math.abs(pose.rightFootY) +
        Math.abs(pose.rightFootAngle) <
      1e-8
    ) {
      if (Math.max(Math.abs(pose.leftWing), Math.abs(pose.rightWing)) < 0.01) drawCell(0, 458, 512);
      else {
        // The old strip includes a slice of the folded belly above the toes.
        // Keep that slice only at the two actual leg contacts, not as a floating bar.
        drawCell(0, 468, 512);
        context.save();
        context.beginPath();
        context.ellipse(219, 468, 33, 15, 0, 0, Math.PI * 2);
        context.ellipse(314, 468, 35, 15, 0, 0, Math.PI * 2);
        context.clip();
        drawCell(0, 458, 468);
        context.restore();
      }
    } else {
      foot(0, 266, 219, pose.leftFootX, pose.leftFootY, pose.leftFootAngle);
      foot(266, 246, 314, pose.rightFootX, pose.rightFootY, pose.rightFootAngle);
    }
    if (Math.abs(pose.leftWing) + Math.abs(pose.rightWing) + Math.abs(pose.scarf) < 1e-8)
      drawCell(0, 277, 460);
    else {
      const openness = Math.min(
        1,
        Math.max(Math.abs(pose.leftWing), Math.abs(pose.rightWing)) / 0.5,
      );
      const weight = openness * openness * (3 - 2 * openness);
      const operation = context.globalCompositeOperation;
      if (weight > 0 && weight < 1) context.globalCompositeOperation = 'lighter';
      context.globalAlpha = 1 - weight;
      context.drawImage(parts.body, 0, 0);
      context.globalAlpha = weight;
      context.drawImage(parts.cleanBody, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = operation;
      wing(true, pose.leftWing, weight);
      wing(false, pose.rightWing, weight);
      joint(parts.scarf, 343, 284, pose.scarf);
    }
  }
  context.save();
  context.translate(256 + pose.headX, 284 + pose.headY);
  context.rotate(pose.headAngle);
  context.translate(-256, -284);
  drawCell(pose.cell, 0, 286);
  if (!pose.cell && pose.blink > 0) {
    // Reuse the original closed eyes, feather the patch edge and protect the pointed beak.
    let eyelids = image.originalOwlEyelids;
    if (!eyelids) {
      eyelids = [
        [155, 642, 103, 90],
        [289, 636, 102, 90],
      ].map(([sx, sy, sw, sh], index) => {
        const canvas = context.canvas.ownerDocument.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.translate(sw / 2, sh / 2);
        ctx.scale(sw / 2, sh / 2);
        const edge = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        edge.addColorStop(0, '#fff');
        edge.addColorStop(0.88, '#fff');
        edge.addColorStop(1, 'transparent');
        ctx.fillStyle = edge;
        ctx.fillRect(-1, -1, 2, 2);
        const blank = context.canvas.ownerDocument.createElement('canvas');
        blank.width = sw;
        blank.height = sh;
        const white = blank.getContext('2d');
        white.drawImage(image, 243, 125, 35, 64, 0, 0, sw, sh);
        white.globalCompositeOperation = 'destination-in';
        white.drawImage(canvas, 0, 0);
        const open = context.canvas.ownerDocument.createElement('canvas');
        const [x, y, width, height] = index ? [279, 153, 102, 106] : [155, 143, 103, 104];
        open.width = width;
        open.height = height;
        const eye = open.getContext('2d');
        eye.drawImage(image, x, y, width, height, 0, 0, width, height);
        return { closed: canvas, blank, open };
      });
      image.originalOwlEyelids = eyelids;
    }
    context.beginPath();
    context.rect(0, 0, 512, 512);
    context.rect(243, 205, 46, 61);
    context.clip('evenodd');
    // Keep one eye image at a time. Clipping the original eye into its lid line
    // avoids the doubled pupils/lashes produced by an open/closed alpha dissolve.
    for (const [index, x, y, width, height] of [
      [0, 155, 143, 103, 104],
      [1, 279, 153, 102, 106],
    ]) {
      const eye = eyelids[index];
      if (pose.blink >= 0.96) context.drawImage(eye.closed, x, y, width, height);
      else {
        context.drawImage(eye.blank, x, y, width, height);
        const aperture = height * 0.78 * (1 - pose.blink);
        context.save();
        context.beginPath();
        context.rect(x, y + height / 2 - aperture / 2, width, aperture);
        context.clip();
        // The source iris is already 253/255 alpha. Copy its original pixels inside
        // the aperture instead of brightening them over the white eyelid underpaint.
        context.globalCompositeOperation = 'copy';
        context.drawImage(eye.open, x, y, width, height);
        context.restore();
      }
    }
  }
  context.restore();
  context.restore();
}
