'use strict';

const fs = require('node:fs');
const path = require('node:path');

const NVIDIA_DRIVER_CUDA_LIB = /^libcuda\.so(\.|$)/i;

function assertNoNvidiaDriverLibraries(rootDir) {
  const queue = [rootDir];
  while (queue.length > 0) {
    const currentDir = queue.shift();
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (NVIDIA_DRIVER_CUDA_LIB.test(entry.name)) {
        throw new Error(
          `[finalize-llamacpp-cuda-edition] Refusing to bundle NVIDIA driver library ${entry.name}; runtime must use the host driver.`,
        );
      }
    }
  }
}

module.exports = {
  assertNoNvidiaDriverLibraries,
  NVIDIA_DRIVER_CUDA_LIB,
};
