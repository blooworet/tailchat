import { CommandModule } from 'yargs';
import { io, Socket } from 'socket.io-client';
import msgpackParser from 'socket.io-msgpack-parser';
import fs from 'fs-extra';
import ora from 'ora';
import randomString from 'crypto-random-string';
import pMap from 'p-map';
import { generateClientKeyPair, deriveAuthKey, computeAuthKeyId, encryptEnvelope, decryptEnvelope, TpSession, TpEnvelope } from '../../lib/tailproto';

const CLIENT_CREATION_INTERVAL_IN_MS = 5;

export const benchmarkConnectionsCommand: CommandModule = {
  command: 'connections <url>',
  describe: 'Test Tailchat Connections',
  builder: (yargs) =>
    yargs
      .demandOption('url', 'Backend Url')
      .option('file', {
        describe: 'Account Token Path',
        demandOption: true,
        type: 'string',
        default: './accounts',
      })
      .option('concurrency', {
        describe: 'Concurrency when create connection',
        type: 'number',
        default: 1,
      })
      .option('groupId', {
        describe: 'Group Id which send Message',
        type: 'string',
      })
      .option('converseId', {
        describe: 'Converse Id which send Message',
        type: 'string',
      })
      .option('messageNum', {
        describe: 'Times which send Message',
        type: 'number',
        default: 1,
      })
      .option('mode', {
        describe: 'Benchmark mode: plaintext|tp|tp-batch',
        type: 'string',
        default: 'plaintext',
      })
      .option('batchMaxItems', {
        describe: 'Batch max items when mode=tp-batch',
        type: 'number',
        default: 10,
      })
      .option('batchMaxDelay', {
        describe: 'Batch max delay(ms) when mode=tp-batch',
        type: 'number',
        default: 15,
      }),
  async handler(args) {
    const url = args.url as string;
    const file = args.file as string;
    const groupId = args.groupId as string;
    const converseId = args.converseId as string;
    const messageNum = args.messageNum as number;
    const concurrency = args.concurrency as number;

    console.log('Reading account tokens from', file);
    const account = await fs.readFile(file as string, {
      encoding: 'utf8',
    });
    const sockets = await createClients(
      url as string,
      account.split('\n').map((s) => s.trim()),
      concurrency,
      (args.mode as string) || 'plaintext'
    );

    if (groupId && converseId) {
      // send message test
      if (messageNum > 1) {
        console.log(`Start send messages concurrently: ${messageNum}`);
        await Promise.all(
          Array.from({ length: messageNum }).map(() => sendMessage(sockets, groupId, converseId))
        );
      } else {
        console.log('Start send message test: 1');
        await sendMessage(sockets, groupId, converseId);
      }
    }
  },
};

async function createClients(
  url: string,
  accountTokens: string[],
  concurrency: number,
  mode: string
): Promise<Socket[]> {
  const maxCount = accountTokens.length;
  const spinner = ora().info(`Create Client Connection to ${url}`).start();

  let i = 0;
  const sockets: Socket[] = [];
  await pMap(
    accountTokens,
    async (token) => {
      await sleep(CLIENT_CREATION_INTERVAL_IN_MS);
      const socket = await createClient(url, token, mode);
      spinner.text = `Progress: ${++i}/${maxCount}`;
      sockets.push(socket);
    },
    {
      concurrency,
    }
  );

  spinner.succeed(`${maxCount} clients has been create.`);

  return sockets;
}

function createClient(url: string, token: string, mode: string): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const socket = io(url, {
      transports: ['websocket'],
      auth: {
        token,
      },
      forceNew: true,
      parser: msgpackParser,
    });
    socket.once('connect', () => {
      // 连接成功
      resolve(socket);
    });
    socket.once('error', () => {
      reject();
    });

    socket.on('disconnect', (reason) => {
      console.log(`disconnect due to ${reason}`);
    });
  }).then(async (socket) => {
    await socket.emitWithAck('chat.converse.findAndJoinRoom', {});
    if (mode !== 'plaintext') {
      // TailProto handshake
      const { ecdh, publicKeyBase64 } = generateClientKeyPair();
      await new Promise<void>((res, rej) => {
        socket.emit('crypt.init', { clientPubKey: publicKeyBase64 }, (resp: any) => {
          if (!(resp && resp.result === true)) return rej(new Error('crypt.init failed'));
          const d = resp.data || {};
          const authKey = deriveAuthKey(ecdh, String(d.serverPubKey || ''));
          const session: TpSession = {
            authKey,
            authKeyId: computeAuthKeyId(authKey),
            kv: Number(d.kv) || 1,
            seq: 0,
          };
          (socket as any).__tp = { session, mode };
          res();
        });
      });
    }
    return socket;
  });
}

async function sendMessage(
  sockets: Socket[],
  groupId: string,
  converseId: string
) {
  return new Promise<void>((resolve) => {
    const randomMessage = randomString({ length: 16 });
    const spinner = ora()
      .info(`Start message receive test, message: ${randomMessage}`)
      .start();
    const start = Date.now();
    let receiveCount = 0;
    const len = sockets.length;

    function receivedCallback() {
      receiveCount += 1;
      spinner.text = `Receive: ${receiveCount}/${len}`;

      if (receiveCount === len) {
        spinner.succeed(`All client received, usage: ${Date.now() - start}ms`);
        resolve();
      }
    }

    sockets.forEach((socket) => {
      const handler = (message: any) => {
        // TailProto decrypt if needed
        const tp = (socket as any).__tp;
        if (tp && message && typeof message === 'object' && (message as TpEnvelope).v === 2) {
          try { message = decryptEnvelope(tp.session as TpSession, message as TpEnvelope); } catch {}
        }
        const content = message.content;
        if (message.converseId === converseId && randomMessage === content) {
          socket.off('notify:chat.message.add', handler);
          receivedCallback();
        }
      };
      socket.on('notify:chat.message.add', handler);
    });

    // 直接发送消息
    const s0 = sockets[0];
    const tp = (s0 as any).__tp as { session: TpSession; mode: string } | undefined;
    const payload = { groupId, converseId, content: randomMessage };
    if (tp && tp.mode === 'tp') {
      const env = encryptEnvelope(tp.session, payload);
      s0.emit('chat.message.sendMessage', env);
    } else if (tp && tp.mode === 'tp-batch') {
      const env = encryptEnvelope(tp.session, [{ ev: 'chat.message.sendMessage', data: payload }]);
      s0.emit('tp.batch', env);
    } else {
      s0.emit('chat.message.sendMessage', payload);
    }
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}