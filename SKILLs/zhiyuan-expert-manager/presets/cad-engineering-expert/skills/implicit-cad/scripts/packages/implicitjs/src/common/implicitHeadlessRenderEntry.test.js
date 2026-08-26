import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ORBIT_DURATION_SECONDS,
  DEFAULT_ORBIT_FPS,
  orbitFrameOutputs
} from "./implicitHeadlessOrbitFrames.js";

test("orbitFrameOutputs uses calm default orbit timing", () => {
  const orbit = orbitFrameOutputs({
    mode: "orbit",
    outputs: [{ path: "orbit.gif" }]
  });

  assert.equal(orbit.fps, DEFAULT_ORBIT_FPS);
  assert.equal(orbit.durationSeconds, DEFAULT_ORBIT_DURATION_SECONDS);
  assert.equal(orbit.frameCount, 72);
  assert.equal(orbit.outputs.length, 72);
  assert.equal(orbit.outputs[0].camera, "-45:28");
  assert.equal(orbit.outputs.at(-1).camera, "310:28");
});

test("orbitFrameOutputs honors explicit orbit timing", () => {
  const orbit = orbitFrameOutputs({
    mode: "orbit",
    orbit: {
      fps: 18,
      durationSeconds: 4,
      turns: 0.5,
      startAzimuth: 10,
      elevation: 20
    },
    outputs: [{ path: "orbit.gif" }]
  });

  assert.equal(orbit.fps, 18);
  assert.equal(orbit.durationSeconds, 4);
  assert.equal(orbit.frameCount, 72);
  assert.equal(orbit.outputs[0].camera, "10:20");
  assert.equal(orbit.outputs.at(-1).camera, "187.5:20");
});
