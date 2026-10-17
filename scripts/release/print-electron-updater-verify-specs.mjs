import { listElectronUpdaterVerifySpecs } from './inference-edition-targets.mjs';

const manifestRoot = process.argv[2] || 'manifest/electron';
for (const spec of listElectronUpdaterVerifySpecs(manifestRoot)) {
  console.log(spec);
}
