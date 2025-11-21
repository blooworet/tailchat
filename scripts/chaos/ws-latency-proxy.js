const WebSocket = require('ws');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const argv = yargs(hideBin(process.argv))
  .option('target', { type: 'string', demandOption: true })
  .option('listen', { type: 'string', demandOption: true })
  .option('delayMs', { type: 'number', default: 80 })
  .argv;

const listenUrl = new URL(argv.listen);
const port = Number(listenUrl.port || 0) || 12000;
const server = new WebSocket.Server({ port });
console.log('[Chaos] WS latency proxy listening on', `ws://127.0.0.1:${port}`, '→', argv.target, 'delay', argv.delayMs, 'ms');

server.on('connection', (client) => {
  const upstream = new WebSocket(argv.target);

  client.on('message', (data) => {
    setTimeout(() => {
      try { upstream.send(data); } catch {}
    }, argv.delayMs);
  });

  upstream.on('message', (data) => {
    setTimeout(() => {
      try { client.send(data); } catch {}
    }, argv.delayMs);
  });

  client.on('close', () => { try { upstream.close(); } catch {} });
  upstream.on('close', () => { try { client.close(); } catch {} });
});
