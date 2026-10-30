// Run the real bridge in a disposable process: a parser crash must not kill Vitest.
const { BridgeServer } = require('../dist/server/index.js');
const bridge = new BridgeServer({ server: { host: '127.0.0.1', port: 0 } });

bridge.start().then(() => {
  process.send({ port: bridge.httpServer.address().port });
});
process.on('message', async () => {
  await bridge.stop();
  process.exit(0);
});
setTimeout(() => process.exit(2), 15000).unref();
