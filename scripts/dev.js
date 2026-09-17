const { spawn } = require('child_process');
const { createServer } = require('vite');
const electron = require('electron');

async function startApp() {
  process.env.VITE_SKIP_ELECTRON = '1';
  const server = await createServer({
    server: {
      port: 5175,
      strictPort: true,
    },
  });
  await server.listen();

  const proc = spawn(electron, ['.'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ELECTRON_START_URL: 'http://localhost:5175',
    },
  });

  let shuttingDown = false;
  const shutdown = async exitCode => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (proc.exitCode === null && proc.signalCode === null) proc.kill();
    await server.close();
    process.exit(exitCode);
  };

  proc.once('close', exitCode => {
    void shutdown(exitCode ?? 1);
  });
  proc.once('error', error => {
    console.error('Electron development process failed:', error);
    void shutdown(1);
  });

  process.once('SIGINT', () => void shutdown(0));
  process.once('SIGTERM', () => void shutdown(0));
}

startApp().catch(err => {
  console.error('Error starting app:', err);
  process.exit(1);
});
