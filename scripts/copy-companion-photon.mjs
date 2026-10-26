import fs from 'node:fs';
import path from 'node:path';

/** The web Photon ABI differs from photon-node; keep its WASM under a distinct name. */
export function copyCompanionPhoton(projectRoot, outputDirectory) {
  const candidates = [
    'node_modules/@earendil-works/pi-durable/node_modules/@silvia-odwyer/photon/photon_rs_bg.wasm',
    'node_modules/@silvia-odwyer/photon/photon_rs_bg.wasm',
  ];
  const source = candidates
    .map(file => path.join(projectRoot, file))
    .find(file => fs.existsSync(file));
  if (!source) throw new Error('Companion Photon WASM is missing');
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.copyFileSync(source, path.join(outputDirectory, 'companion-photon.wasm'));
}
