/** Offline skinning of the approved whole artwork, with no regenerated facial parts. */
export function originalMesh(canvas, image, frame, unit, character) {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    antialias: false,
  });
  if (!gl) throw new Error('Original-art authoring needs WebGL');
  const shader = (type, source) => {
    const value = gl.createShader(type);
    gl.shaderSource(value, source);
    gl.compileShader(value);
    if (!gl.getShaderParameter(value, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(value));
    return value;
  };
  const program = gl.createProgram();
  gl.attachShader(
    program,
    shader(
      gl.VERTEX_SHADER,
      'attribute vec2 position; attribute vec2 uv; varying vec2 tex; void main(){tex=uv;gl_Position=vec4(position,0.,1.);}',
    ),
  );
  gl.attachShader(
    program,
    shader(
      gl.FRAGMENT_SHADER,
      'precision mediump float; varying vec2 tex; uniform sampler2D art; void main(){vec4 color=texture2D(art,tex);if(color.a<=8.0/255.0)color=vec4(0.);else color.rgb/=color.a;gl_FragColor=color;}',
    ),
  );
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // Filter premultiplied pixels so invisible RGB cannot bleed colored fringes into fur.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  const columns = 32,
    rows = 40;
  const vertices = new Float32Array((columns + 1) * (rows + 1) * 4);
  const indices = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const a = y * (columns + 1) + x,
        b = a + columns + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (const [name, offset] of [
    ['position', 0],
    ['uv', 8],
  ]) {
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 16, offset);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
  const smooth = (a, b, value) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const [sx, sy, width, height] = frame;
  const scale = (512 * 0.82) / unit;
  const headBase = character === 'mianmian' ? 0.57 : character === 'yunmo' ? 0.6 : 0.59;
  return pose => {
    let index = 0;
    for (let row = 0; row <= rows; row++)
      for (let column = 0; column <= columns; column++) {
        const u = column / columns,
          v = row / rows;
        const head = 1 - smooth(headBase - 0.12, headBase + 0.12, v);
        const side = Math.abs(u - 0.5) * 2;
        const paw = smooth(0.28, 0.78, side) * smooth(0.36, 0.55, v) * (1 - smooth(0.86, 0.98, v));
        const foot = smooth(0.83, 0.98, v);
        const direction = u < 0.5 ? 1 : -1;
        const angle = pose.headAngle * head;
        const dx = (u - 0.5) * width,
          dy = (v - headBase) * height;
        let x = width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle);
        let y = headBase * height + dx * Math.sin(angle) + dy * Math.cos(angle);
        x += pose.headX * head + (u < 0.5 ? pose.leftFootX : pose.rightFootX) * foot * 0.35;
        y += pose.headY * head;
        // Bound local paw motion; large gestures already exist in the original pose.
        y += Math.sin(u < 0.5 ? pose.leftArm : pose.rightArm) * paw * direction * 6;
        y += (u < 0.5 ? pose.leftFootY : pose.rightFootY) * foot * 0.45;
        x += pose.tail * paw * (1 - head) * 5;
        vertices[index++] = ((256 + (x - width / 2) * scale + pose.x * 0.4) / 512) * 2 - 1;
        vertices[index++] = 1 - ((480 + (y - height) * scale + pose.y * 0.5) / 512) * 2;
        vertices[index++] = (sx + u * width) / image.width;
        vertices[index++] = (sy + v * height) / image.height;
      }
    gl.viewport(0, 0, 512, 512);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
  };
}
