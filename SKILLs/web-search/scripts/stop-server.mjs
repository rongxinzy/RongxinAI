#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { stopStandaloneBridge } from '../server/standaloneControl.cjs';

const skillRoot = fileURLToPath(new URL('../', import.meta.url));
if (await stopStandaloneBridge(skillRoot)) {
  console.log('✓ Bridge Server stopped successfully');
} else {
  console.log('No standalone Bridge Server was stopped. Close the application to stop a server it started.');
}
