'use strict';

function packageWindowsInstaller(run, { signed, enterprise, xiaoruan, edition }) {
  const config = signed
    ? 'electron-builder.windows-signed.cjs'
    : enterprise
      ? 'electron-builder.enterprise.cjs'
      : xiaoruan
        ? 'electron-builder.xiaoruan.cjs'
        : 'electron-builder.json';

  if (edition === 'cpu' || edition === 'cuda') {
    run(process.execPath, ['scripts/prepare-inference-edition-runtime.cjs']);
  }
  run('bun', [
    'x',
    'electron-builder',
    '--win',
    'nsis',
    '--x64',
    '--config',
    config,
    '--publish',
    'never',
  ]);
  if (!xiaoruan) {
    run(process.execPath, [
      'scripts/installer-shell/build-distribution.cjs',
      ...(signed ? ['--signed'] : []),
    ]);
  }
}

module.exports = { packageWindowsInstaller };
