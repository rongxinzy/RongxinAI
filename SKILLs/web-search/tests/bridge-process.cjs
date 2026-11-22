const { BridgeServer, runBridgeProcess } = require('../dist/server/index.js');
const [root, chromePath] = process.argv.slice(2);
const bridge = new BridgeServer({
  server: { host: '127.0.0.1', port: 0 },
  ...(chromePath && { browser: { chromePath, userDataDir: root } }),
});

runBridgeProcess(bridge, root)
  .then(() => {
    console.log(`ready:${bridge.httpServer.address().port}`);
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
