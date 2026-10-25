/** Platform packaging pipelines; package.json retains the public command names. */
export const packageCommands = {
  pack: 'bun run setup:uv-runtime && bun run setup:python-runtime && bun run setup:posix-uv-runtime && bun run setup:posix-python-runtime && bun run build && bun run build:skills && bun run channel:runtime:download && bun run engram:runtime:host && electron-builder --dir',
  dist: 'bun run setup:uv-runtime && bun run setup:python-runtime && bun run setup:posix-uv-runtime && bun run setup:posix-python-runtime && bun run build && bun run build:skills && bun run channel:runtime:download && bun run engram:runtime:host && electron-builder',
  'dist:mac':
    'bun run channel:runtime:mac-arm64 && bun run engram:runtime:mac-arm64 && electron-builder --mac --config electron-builder.json --publish never',
  'dist:mac:x64':
    'bun run prepare:update-release && bun run build && bun run build:skills && bun run channel:runtime:mac-x64 && bun run engram:runtime:mac-x64 && electron-builder --mac --x64 --publish never',
  'dist:mac:arm64':
    'bun run prepare:update-release && bun run build && bun run build:skills && bun run channel:runtime:mac-arm64 && bun run engram:runtime:mac-arm64 && electron-builder --mac --arm64 --publish never',
  'dist:mac:universal':
    'bun run prepare:update-release && bun run build && bun run build:skills && bun run channel:runtime:mac-universal && bun run engram:runtime:mac-arm64 && electron-builder --mac --universal --publish never',
  'dist:win:offline':
    'cross-env ZHIYUAN_ALLOW_HOST_CHANNEL_RUNTIME=1 bun run channel:runtime:win-x64 && bun run engram:runtime:win-x64 && bun run prepare:update-release && node scripts/ensure-build-version.js && bun run build && bun run build:skills && electron-builder --win nsis --x64 --config electron-builder.json --publish never && node scripts/installer-shell/build-distribution.cjs',
  'dist:win:signed':
    'cross-env ZHIYUAN_ALLOW_HOST_CHANNEL_RUNTIME=1 bun run channel:runtime:win-x64 && bun run engram:runtime:win-x64 && bun run prepare:update-release && node scripts/ensure-build-version.js && bun run build && bun run build:skills && electron-builder --win nsis --x64 --config electron-builder.windows-signed.cjs --publish never && node scripts/installer-shell/build-distribution.cjs --signed',
  'dist:win:enterprise':
    'cross-env ZHIYUAN_ALLOW_HOST_CHANNEL_RUNTIME=1 bun run channel:runtime:win-x64 && bun run engram:runtime:win-x64 && bun run prepare:update-release && cross-env ZHIYUAN_UPDATE_VARIANT=lite node scripts/ensure-build-version.js && bun run build && bun run build:enterprise && bun run build:skills && electron-builder --win nsis --x64 --config electron-builder.enterprise.cjs --publish never',
  'dist:win:xiaoruan':
    'cross-env APP_EDITION=xiaoruan ZHIYUAN_ALLOW_HOST_CHANNEL_RUNTIME=1 bun run channel:runtime:win-x64 && bun run engram:runtime:win-x64 && bun run prepare:update-release && cross-env ZHIYUAN_UPDATE_VARIANT=lite node scripts/ensure-build-version.js && bun run build && bun run build:skills && electron-builder --win nsis --x64 --config electron-builder.xiaoruan.cjs --publish never',
  'dist:win:cpu':
    'cross-env ZHIYUAN_UPDATE_VARIANT=cpu bun run prepare:inference-edition-runtime && cross-env ZHIYUAN_UPDATE_VARIANT=cpu bun run dist:win:offline',
  'dist:win:cuda':
    'cross-env ZHIYUAN_UPDATE_VARIANT=cuda bun run prepare:inference-edition-runtime && cross-env ZHIYUAN_UPDATE_VARIANT=cuda bun run dist:win:offline',
  'dist:win:signed:cpu':
    'cross-env ZHIYUAN_UPDATE_VARIANT=cpu bun run prepare:inference-edition-runtime && cross-env ZHIYUAN_UPDATE_VARIANT=cpu bun run dist:win:signed',
  'dist:win:signed:cuda':
    'cross-env ZHIYUAN_UPDATE_VARIANT=cuda bun run prepare:inference-edition-runtime && cross-env ZHIYUAN_UPDATE_VARIANT=cuda bun run dist:win:signed',
  'dist:linux':
    'bun run build && bun run build:skills && bun run engram:runtime:linux-x64 && electron-builder --linux --publish never',
  'dist:linux:cpu':
    'cross-env ZHIYUAN_UPDATE_VARIANT=cpu bun run sync:vendor-llamacpp-cpu && cross-env ZHIYUAN_UPDATE_VARIANT=cpu bun run prepare:inference-edition-runtime && cross-env ZHIYUAN_UPDATE_VARIANT=cpu bun run dist:linux',
  'dist:linux:cuda':
    'cross-env ZHIYUAN_UPDATE_VARIANT=cuda bun run sync:vendor-llamacpp-cpu && bash scripts/build-llamacpp-cuda-rtx40.sh linux && cross-env ZHIYUAN_UPDATE_VARIANT=cuda bun run finalize:vendor-llamacpp-cuda && cross-env ZHIYUAN_UPDATE_VARIANT=cuda bun run prepare:inference-edition-runtime && cross-env ZHIYUAN_UPDATE_VARIANT=cuda bun run dist:linux',
};
