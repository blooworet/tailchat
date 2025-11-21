import { Server as SocketServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { instrument } from '@socket.io/admin-ui';
import RedisClient from 'ioredis';
import {
  TcService,
  TcContext,
  UserJWTPayload,
  parseLanguageFromHead,
  config,
  PureContext,
  PureService,
  PureServiceSchema,
  Utils,
  Errors,
} from 'tailchat-server-sdk';
import _ from 'lodash';
import { ServiceUnavailableError } from 'tailchat-server-sdk';
import { isValidStr } from '../lib/utils';
import bcrypt from 'bcryptjs';
import msgpackParser from 'socket.io-msgpack-parser';
import { generateServerKeyPair, deriveAuthKey, computeAuthKeyId, encryptPayload, decryptPayload, randomIv } from '../lib/tailproto/crypto';
import { TailProtoSessionRegistry } from '../lib/tailproto/session-registry';
import { createSessionToken, verifyAndExtractSessionToken } from '../lib/tailproto/session-token';
import { sendEvent as busSend, stopProducer } from '../lib/bus/kafka.producer';
import { startTailProtoConsumers, stopTailProtoConsumers } from '../lib/bus/kafka.consumer';
import { TailProtoRekeyScheduler } from '../lib/tailproto/rekey';
import { startKafkaLagCollector } from '../lib/bus/metrics.kafka';
import jwt from 'jsonwebtoken';
import { checkBusHealth } from '../lib/bus/health';

// 黑名单排除 gateway.health 与 gateway.checkUserOnline，但限制其他 gateway 请求
const blacklist: (string | RegExp)[] = [/^gateway\.(?!(health$|checkUserOnline$)).*/];

function checkBlacklist(eventName: string): boolean {
  return blacklist.some((item) => {
    if (_.isString(item)) {
      return Utils.match(eventName, item);
    } else if (_.isRegExp(item)) {
      return item.test(eventName);
    }
  });
}

/**
 * socket 用户房间编号
 */
function buildUserRoomId(userId: string) {
  return `u-${userId}`;
}

/**
 * socket online 用户编号
 */
function buildUserOnlineKey(userId: string) {
  return `tailchat-socketio.online:${userId}`;
}

const expiredTime = 1 * 24 * 60 * 60; // 1天

interface SocketIOService extends PureService {
  io: SocketServer;
  redis: RedisClient.Redis;
  socketCloseCallbacks: (() => Promise<unknown>)[];
  _tpRekey?: TailProtoRekeyScheduler;
  logger: any;
  broker: any;
}

interface TcSocketIOServiceOptions {
  /**
   * 用户token校验
   */
  userAuth: (token: string) => Promise<UserJWTPayload>;

  /**
   * 是否禁用msgpack
   */
  disableMsgpack?: boolean;
}

/**
 * 简单的JSON序列化安全函数
 */
function toJSONSafe(input: any): any {
  if (input === null || input === undefined) {
    return input;
  }
  
  try {
    // 简单的序列化处理，不进行复杂的转换
    return JSON.parse(JSON.stringify(input));
  } catch (e) {
    return { 
      error: 'Serialization failed', 
      message: String(e) 
    };
  }
}

/**
 * Socket IO 服务 mixin
 */
export const TcSocketIOService = (
  options: TcSocketIOServiceOptions
): Partial<PureServiceSchema> => {
  const { userAuth } = options;

  const schema: Partial<PureServiceSchema> = {
    created(this: SocketIOService) {
      this.broker.metrics.register({
        type: 'gauge',
        name: 'tailchat.socketio.online.count',
        labelNames: ['nodeId'],
        description: 'Number of online user',
      });
      try {
        this.broker.metrics.register({ type: 'gauge', name: 'tailproto_active_sessions', labelNames: [], description: 'Active TailProto sessions in registry' });
      } catch {}
      // Cross-region bus metrics
      try {
        this.broker.metrics.register({ type: 'counter', name: 'tailproto_bus_messages_total', labelNames: ['topic'], description: 'Total consumed bus messages' });
        this.broker.metrics.register({ type: 'counter', name: 'tailproto_bus_verify_failures_total', labelNames: ['topic'], description: 'Signature verify failures' });
        this.broker.metrics.register({ type: 'counter', name: 'tailproto_bus_rekey_delivered_total', labelNames: [], description: 'Delivered rekey notifications' });
        this.broker.metrics.register({ type: 'counter', name: 'tailproto_bus_session_update_total', labelNames: [], description: 'Consumed session.update messages' });
        this.broker.metrics.register({ type: 'gauge', name: 'tailproto_bus_apparent_lag_ms', labelNames: ['topic', 'partition'], description: 'Approx message lag from produce timestamp' });
      } catch {}
    },
    async started(this: SocketIOService) {
      if (!this.io) {
        this.initSocketIO();
      }

      this.logger.info('SocketIO service started');

      const io: SocketServer = this.io;
      if (!config.redisUrl) {
        throw new Errors.MoleculerClientError(
          'SocketIO service failed to start, environment variables are required: `REDIS_URL`'
        );
      }
      this.socketCloseCallbacks = []; // socketio服务关闭时需要执行的回调

      const pubClient = new RedisClient(config.redisUrl, {
        retryStrategy(times) {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      });
      const subClient = pubClient.duplicate();
      io.adapter(
        createAdapter(pubClient, subClient, {
          key: 'tailchat-socket',
        })
      );

      this.socketCloseCallbacks.push(async () => {
        pubClient.disconnect(false);
        subClient.disconnect(false);
      });
      this.logger.info('SocketIO is using Redis Adapter');

      this.redis = pubClient;
      // /health/bus endpoint
      const healthHandler = async (req: any, res: any) => {
        try {
          if (req && typeof req.url === 'string' && req.method === 'GET' && req.url.startsWith('/health/bus')) {
            const data = await checkBusHealth();
            const body = Buffer.from(JSON.stringify(data));
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.setHeader('content-length', String(body.length));
            res.end(body);
            return;
          }
        } catch {}
      };
      try { (this.server as any).on('request', healthHandler); } catch {}
      this.socketCloseCallbacks.push(async () => { try { (this.server as any).off('request', healthHandler); } catch {} });
      // 启动跨 Region 总线消费者（按开关）
      try {
        const enabled = Boolean((config as any).feature?.crossRegionEnabled);
        if (enabled) {
          await startTailProtoConsumers(this.io, this.redis, this.logger, {
            inc: (name: string, labels?: any, v?: number) => { try { this.broker.metrics.increment(name, labels || {}, v || 1); } catch {} },
            set: (name: string, labels: any, v: number) => { try { (this.broker.metrics as any).set(name, labels || {}, v); } catch {} },
          });
          this.socketCloseCallbacks.push(async () => stopTailProtoConsumers(this.logger));
          this.logger.info('[Bus] Cross-region consumers started');
          // Kafka consumer lag collector (precise)
          try {
            this.broker.metrics.register({ type: 'gauge', name: 'crossregion_kafka_consumer_lag', labelNames: ['topic','partition'], description: 'Kafka consumer lag per topic/partition' });
            this.broker.metrics.register({ type: 'gauge', name: 'crossregion_kafka_replication_lag_ms', labelNames: ['topic'], description: 'Estimated inter-region replication lag' });
          } catch {}
          const brokersRaw = (config as any).feature?.kafkaBrokers as string;
          const brokers = String(brokersRaw || '').split(',').map((s) => s.trim()).filter(Boolean);
          const lag = startKafkaLagCollector({
            brokers,
            groupId: 'tailproto-rekey-session-consumer',
            topics: ['tailproto.rekey.request', 'tailproto.session.update'],
            intervalMs: 5000,
            metrics: { set: (name, labels, v) => { try { (this.broker.metrics as any).set(name, labels || {}, v); } catch {} } },
            logger: this.logger,
          });
          if (lag) {
            this.socketCloseCallbacks.push(async () => lag.stop());
          }
        } else {
          this.logger.info('[Bus] Cross-region disabled');
        }
      } catch (e) {
        this.logger.warn('[Bus] Cross-region start failed:', String(e));
      }

      // 初始化 TailProto rekey 调度器
      try {
        const intervalMs = (config as any).feature?.tailprotoRekeyIntervalMs ?? 60 * 1000;
        const acceptOldMs = (config as any).feature?.tailprotoRekeyAcceptOldMs ?? 30 * 1000;
        const scheduler = new TailProtoRekeyScheduler(
          pubClient,
          async (sid) => await TailProtoSessionRegistry.get(sid),
          async (userId) => {
            try {
              const force = !!((config as any).feature?.tailprotoRekeyForceNotify ?? true);
              const deadlineMs = Number((config as any).feature?.tailprotoRekeyDeadlineMs ?? 30 * 1000);
              const nowTs = Date.now();
              const sockets = await this.io.in(buildUserRoomId(userId)).fetchSockets();
              for (const sock of sockets) {
                try {
                  const sess = await TailProtoSessionRegistry.get(sock.id);
                  if (sess) (sess as any).rekeyDeadlineTs = nowTs + deadlineMs;
                } catch {}
                sock.emit('notify:tailproto.rekey.required', { ts: nowTs, force, deadlineMs });
              }
              try { this.broker.metrics.increment('tailproto_rekey_force_notified_total', { userId }, 1); } catch {}
            } catch {}
            try {
              const payload = {
                requestId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                userId,
                reason: 'interval_expired',
                originNode: this.broker.nodeID,
                proposedKv: undefined,
                ts: Date.now(),
              };
              await busSend('tailproto.rekey.request', `user:${userId}`, payload);
            } catch {}
          },
          { intervalMs, acceptOldMs },
          (name, labels) => {
            try { this.broker.metrics.increment(name, labels || {}, 1); } catch {}
          },
          async (sid) => { try { await TailProtoSessionRegistry.destroyOldKey(sid); } catch {} }
        );
        scheduler.start();
        this._tpRekey = scheduler;
        this.socketCloseCallbacks.push(async () => scheduler.stop());
      } catch {}

      io.use(async (socket, next) => {
        // 授权
        try {
          if (
            config.enableSocketAdmin &&
            socket.handshake.headers['origin'] === 'https://admin.socket.io'
          ) {
            // 如果是通过 admin-ui 访问的socket.io 直接链接
            next();
            return;
          }

          const token = socket.handshake.auth['token'];
          
          // 认证调试日志（默认关闭；不输出令牌原文）
          if (process.env.TAILCHAT_SOCKET_DEBUG === 'true') {
            try {
              this.logger.debug('[Socket] Auth attempt', {
                hasToken: !!token,
                tokenType: typeof token,
                tokenLength: token?.length,
                authKeys: Object.keys(socket.handshake.auth || {}),
              });
            } catch {}
          }
          
          const credential = typeof token === 'string' ? token : undefined;

          if (typeof credential !== 'string') {
            // 允许游客握手（用于登录/注册），设置游客态
            this.logger.info('[Socket] Guest handshake - no credential');
            (socket.data as any).user = {} as any;
            (socket.data as any).token = undefined as any;
            (socket.data as any).userId = undefined as any;
            return next();
          }

          const user: UserJWTPayload = await userAuth(credential);

          if (!(user && user._id)) {
            throw new Error('Token invalid');
          }

          this.logger.info('[Socket] Authenticated: ', user.nickname);

          socket.data.user = user;
          socket.data.token = credential;
          socket.data.userId = user._id;
          
          // 调试认证结果（默认关闭）
          if (process.env.TAILCHAT_SOCKET_DEBUG === 'true') {
            try {
              this.logger.debug('[Socket] Auth success', {
                socketId: socket.id,
                userName: user?.nickname || 'unknown',
                userIdType: typeof user._id,
                hasUserId: !!user._id,
                userKeys: user ? Object.keys(user) : null,
              });
            } catch {}
          }
          // Detect bot account type for WS guard
          try {
            const info: any = await (this as any).broker.call('user.getUserInfo', {
              userId: user._id,
            });
            socket.data.isBot = info && (info.type === 'openapiBot' || info.type === 'pluginBot');
          } catch (_) {
            socket.data.isBot = false;
          }

          next();
        } catch (e) {
          return next(e);
        }
      });

      this.io.on('connection', (socket) => {
        const isGuest = typeof socket.data.userId !== 'string';
        
        // 调试连接时的 socket.data 状态（默认关闭，仅在显式开启时输出）
        if (process.env.TAILCHAT_SOCKET_DEBUG === 'true') {
          try {
            this.logger.debug('[Socket] Connection established', {
              socketId: socket.id,
              isGuest,
              socketDataUserId: socket.data.userId,
              socketDataUserIdType: typeof socket.data.userId,
              hasSocketDataUser: !!socket.data.user,
              socketDataKeys: Object.keys(socket.data),
            });
          } catch {}
        }

        if (!isGuest) {
          this.broker.metrics.increment(
            'tailchat.socketio.online.count',
            {
              nodeId: this.broker.nodeID,
            },
            1
          );

          const userId = socket.data.userId as string;
          pubClient
            .hset(buildUserOnlineKey(userId), socket.id, this.broker.nodeID)
            .then(() => {
              pubClient.expire(buildUserOnlineKey(userId), expiredTime);
            });

          // 加入自己userId所生产的id
          socket.join(buildUserRoomId(userId));
        }
        // 注册 rekey 调度
        try {
          (this._tpRekey as any)?.register(socket.id, (socket.data as any)?.userId);
        } catch {}

        // 离线时移除在线映射（访客为 no-op）
        const removeOnlineMapping = !isGuest
          ? () => pubClient.hdel(buildUserOnlineKey(socket.data.userId), socket.id)
          : () => Promise.resolve(0 as any);
        this.socketCloseCallbacks.push(removeOnlineMapping);

        // 用户断线
        socket.on('disconnecting', async (reason) => {
          this.logger.info(
            'Socket Disconnect:',
            reason,
            '| Rooms:',
            socket.rooms
          );

          if (!isGuest) {
            this.broker.metrics.decrement(
              'tailchat.socketio.online.count',
              {
                nodeId: this.broker.nodeID,
              },
              1
            );
          }

          removeOnlineMapping();
          _.pull(this.socketCloseCallbacks, removeOnlineMapping);
          // 清理 TailProto 会话并刷新会话计数
          try { await TailProtoSessionRegistry.destroy(socket.id); } catch {}
          try { (this.broker.metrics as any).set('tailproto_active_sessions', await TailProtoSessionRegistry.size(), {}); } catch {}
          try { (this._tpRekey as any)?.unregister(socket.id); } catch {}
        });

        // 统一通知封装：将所有 notify:*（除 rekey）改为外层 'notify' + 加密 envelope
        try {
          const originalEmit = socket.emit.bind(socket) as any;
          (socket as any).emit = function (ev: string, ...args: any[]) {
            try {
              if (typeof ev === 'string' && ev.startsWith('notify:') && ev !== 'notify:tailproto.rekey.required') {
                let payload = args[0];
                Promise.resolve().then(async () => {
                  try {
                    const s = await TailProtoSessionRegistry.get(socket.id);
                    if (!s) return; // 无会话不下发，避免泄露
                    // 若 payload 已是 envelope，则先解密，避免双层封装
                    try {
                      if (payload && typeof payload === 'object' && (payload as any).v === 2 && typeof (payload as any).d === 'string') {
                        const ivB64 = String((payload as any).iv || '');
                        const iv = Buffer.from(ivB64, 'base64');
                        let pt: Buffer | null = null;
                        try {
                          pt = await decryptPayload(s.authKey, String((payload as any).d), iv);
                        } catch {
                          if (s.oldKey) {
                            try { pt = await decryptPayload(s.oldKey as any, String((payload as any).d), iv); } catch {}
                          }
                        }
                        if (pt) {
                          try { payload = JSON.parse(pt.toString('utf8')); } catch { payload = pt.toString('utf8'); }
                        }
                      }
                    } catch {}
                    const inner = { ev, data: payload };
                    const iv = randomIv();
                    const buf = Buffer.from(JSON.stringify(inner));
                    const { ciphertextBase64 } = await encryptPayload(s.authKey, buf, iv);
                    originalEmit('notify', { v: 2, k: s.authKeyId, s: s.lastSeq, kv: s.kv, iv: iv.toString('base64'), d: ciphertextBase64 });
                  } catch {}
                });
                return true;
              }
            } catch {}
            return originalEmit(ev, ...args);
          };
        } catch {}

        socket.onAny(
          async (
            eventName: string,
            eventData: unknown,
            cb: (data: unknown) => void
          ) => {
            // TailProto: crypt.init 握手（明文白名单）
            try {
              if (String(eventName) === 'crypt.init') {
                try {
                  const ed: any = eventData || {};
                  const clientPub = String(ed?.clientPubKey || '');
                  if (!clientPub) {
                    cb({ result: false, message: 'Missing clientPubKey' });
                    return;
                  }
                  const kp = generateServerKeyPair();
                  const authKey = deriveAuthKey(kp.privateKey, clientPub);
                  const existing = await TailProtoSessionRegistry.get(socket.id);
                  const s = existing
                    ? await TailProtoSessionRegistry.rotate(socket.id, authKey)
                    : await TailProtoSessionRegistry.create({
                        socketId: socket.id,
                        userId: (socket.data as any)?.userId,
                        authKey,
                      });
                  try { (s as any).rekeyDeadlineTs = undefined; } catch {}
                  try { (this.broker.metrics as any).set('tailproto_active_sessions', await TailProtoSessionRegistry.size(), {}); } catch {}
                  try {
                    const payload = {
                      userId: (socket.data as any)?.userId || '',
                      sessionId: socket.id,
                      authKeyId: s.authKeyId,
                      kv: s.kv,
                      kvTs: s.kvTs,
                      lastSeq: s.lastSeq,
                      nodeId: this.broker.nodeID,
                      ts: Date.now(),
                      origin: this.broker.nodeID,
                    };
                    await busSend('tailproto.session.update', `user:${payload.userId}`, payload);
                    try {
                      await busSend('tailproto.key.rotated', `user:${payload.userId}`, {
                        userId: payload.userId,
                        kv: s.kv,
                        authKeyId: s.authKeyId,
                        originNode: this.broker.nodeID,
                        ts: Date.now(),
                      });
                      await busSend('tailproto.audit', `user:${payload.userId}`, {
                        type: 'session.update',
                        origin: this.broker.nodeID,
                        userId: payload.userId,
                        ts: Date.now(),
                        details: { event: 'crypt.init' },
                      });
                    } catch {}
                  } catch {}
                  const resumeToken = createSessionToken({ authKey, kv: s.kv, kvTs: s.kvTs, userId: (socket.data as any)?.userId });
                  cb({
                    result: true,
                    data: {
                      serverPubKey: kp.publicKeyBase64,
                      authKeyId: s.authKeyId,
                      kv: s.kv,
                      serverTime: Date.now(),
                      resumeToken,
                    },
                  });
                } catch (e) {
                  cb({ result: false, message: 'crypt.init failed' });
                }
                return;
              }
              if (String(eventName) === 'crypt.resume') {
                try {
                  const ed: any = eventData || {};
                  const token = String(ed?.token || '');
                  if (!token) { cb({ result: false, message: 'Missing token' }); return; }
                  const r = verifyAndExtractSessionToken(token);
                  if (!r) { cb({ result: false, message: 'Invalid token' }); return; }
                  const existing = await TailProtoSessionRegistry.get(socket.id);
                  const s = existing
                    ? await TailProtoSessionRegistry.rotate(socket.id, r.authKey)
                    : await TailProtoSessionRegistry.create({ socketId: socket.id, userId: r.userId, authKey: r.authKey, kv: r.kv });
                  s.kvTs = r.kvTs;
                  try { (s as any).rekeyDeadlineTs = undefined; } catch {}
                  try { (this.broker.metrics as any).set('tailproto_active_sessions', await TailProtoSessionRegistry.size(), {}); } catch {}
                  try {
                    const payload = {
                      userId: r.userId || '',
                      sessionId: socket.id,
                      authKeyId: s.authKeyId,
                      kv: s.kv,
                      kvTs: s.kvTs,
                      lastSeq: s.lastSeq,
                      nodeId: this.broker.nodeID,
                      ts: Date.now(),
                      origin: this.broker.nodeID,
                    };
                    await busSend('tailproto.session.update', `user:${payload.userId}`, payload);
                    try {
                      await busSend('tailproto.key.rotated', `user:${payload.userId}`, {
                        userId: payload.userId,
                        kv: s.kv,
                        authKeyId: s.authKeyId,
                        originNode: this.broker.nodeID,
                        ts: Date.now(),
                      });
                      await busSend('tailproto.audit', `user:${payload.userId}`, {
                        type: 'session.update',
                        origin: this.broker.nodeID,
                        userId: payload.userId,
                        ts: Date.now(),
                        details: { event: 'crypt.resume' },
                      });
                    } catch {}
                  } catch {}
                  cb({ result: true, data: { authKeyId: s.authKeyId, kv: s.kv, serverTime: Date.now() } });
                } catch (e) {
                  cb({ result: false, message: 'crypt.resume failed' });
                }
                return;
              }
            } catch {}
            try {
              let payloadStr: string;
              try {
                payloadStr = JSON.stringify(eventData);
              } catch {
                payloadStr = `[unserializable:${typeof eventData}]`;
              }
              if (process.env.TAILCHAT_SOCKET_DEBUG === 'true') {
                this.logger.debug('[SocketIO]', eventName, '<=', payloadStr);
              }
            } catch {}

            // Strict TailProto: only 3 plaintext events are allowed; others must be tp.invoke
            try {
              const name = String(eventName);
              const allowPlain = (name === 'crypt.init' || name === 'crypt.resume' || name === 'notify:tailproto.rekey.required');
              if (!allowPlain && name !== 'tp.invoke') {
                cb({ result: false, message: 'TailProto required' });
                return;
              }
            } catch {}

            // 检测是否允许调用
            if (checkBlacklist(eventName)) {
              const message = 'Not allowed request';
              this.logger.warn('[SocketIO]', '=>', message);
              cb({
                result: false,
                message,
              });
              return;
            }

            // 接受任意消息, 并调用action
            try {
              let _tpMsgId: string | undefined;
              // TailProto: handle tp.invoke - unwrap inner { ev, data } after strict checks
              try {
                if (String(eventName) === 'tp.invoke') {
                  const s = await TailProtoSessionRegistry.get(socket.id);
                  if (!s) { cb({ result: false, message: 'TailProto required' }); return; }
                  const ed: any = eventData;
                  if (!(ed && typeof ed === 'object' && (ed as any).v === 2 && typeof (ed as any).d === 'string')) {
                    cb({ result: false, message: 'Invalid envelope' });
                    return;
                  }
                  const nowTs = Date.now();
                  const acceptOldMs = (config as any).feature?.tailprotoRekeyAcceptOldMs ?? 30 * 1000;
                  const kvVal = Number((ed as any).kv);
                  const isCurrentKv = Number.isFinite(kvVal) && kvVal === s.kv;
                  const isPrevKv = Number.isFinite(kvVal) && kvVal === s.kv - 1;
                  const isPrevKvInWindow = isPrevKv && (nowTs - s.kvTs) <= acceptOldMs;
                  if (!(isCurrentKv || isPrevKvInWindow)) {
                    cb({ result: false, message: 'Invalid key version' });
                    return;
                  }
                  const seq = Number((ed as any).s);
                  const seqWindow = Number(((config as any).feature?.tailprotoSeqWindow ?? 1000) as number);
                  if (!Number.isFinite(seq)) { cb({ result: false, message: 'Invalid seq' }); return; }
                  if (seq > s.lastSeq) {
                    s.lastSeq = seq;
                  } else if (s.lastSeq - seq >= seqWindow) {
                    try { this.logger.warn('[TailProto][seq] replay-window exceeded, soft-accept', { seq, lastSeq: s.lastSeq, window: seqWindow, eventName }); } catch {}
                  }
                  if (typeof (ed as any).m === 'string' && (ed as any).m.length > 0) {
                    _tpMsgId = String((ed as any).m);
                  }
                  const ivB64 = String((ed as any).iv || '');
                  const iv = Buffer.from(ivB64, 'base64');
                  // 旧钥允许窗口
                  const maxHits = Number(((config as any).feature?.tailprotoOldKeyMaxHits ?? 50) as number);
                  const maxDurMs = Number(((config as any).feature?.tailprotoOldKeyMaxDurationMs ?? 3000) as number);
                  const hits = Number(((s as any).oldKeyHits ?? 0) as number);
                  const firstAt = Number(((s as any).oldKeyFirstHitAt ?? 0) as number);
                  const withinReuseLimits = hits < maxHits && (firstAt === 0 || (nowTs - firstAt) <= maxDurMs);
                  const allowUseOld = isPrevKvInWindow && !!s.oldKey && withinReuseLimits;
                  const keyToUse = allowUseOld ? (s.oldKey as Buffer) : s.authKey;
                  const pt = await decryptPayload(keyToUse, String((ed as any).d), iv);
                  if (allowUseOld) {
                    try { (s as any).oldKeyHits = hits + 1; if (!((s as any).oldKeyFirstHitAt)) (s as any).oldKeyFirstHitAt = nowTs; } catch {}
                  } else {
                    try {
                      if (s.oldKey) { s.oldKey = undefined; (s as any).oldKeyCreatedAt = undefined; (s as any).oldKeyHits = undefined; (s as any).oldKeyFirstHitAt = undefined; }
                    } catch {}
                  }
                  let inner: any = null;
                  try { inner = JSON.parse(pt.toString('utf8')); } catch {}
                  if (!inner || typeof inner.ev !== 'string') { cb({ result: false, message: 'Invalid inner payload' }); return; }
                  // rewrite to inner event for existing flow
                  eventName = String(inner.ev);
                  eventData = inner.data;
                }
              } catch {}
              // TailProto: Rekey deadline 强制期执法（非白名单/非握手事件）
              try {
                const s0 = await TailProtoSessionRegistry.get(socket.id);
                const now0 = Date.now();
                const isHandshake = String(eventName) === 'crypt.init';
                const isWhitelisted = ['crypt.init','crypt.resume','notify:tailproto.rekey.required'].includes(String(eventName));
                if (s0 && s0.rekeyDeadlineTs && now0 > s0.rekeyDeadlineTs && !isHandshake && !isWhitelisted) {
                  try { this.broker.metrics.increment('tailproto_key_invalidations_total', { reason: 'deadline' }, 1); } catch {}
                  const disconnectOnExpired = !!((config as any).feature?.tailprotoRekeyDisconnectOnExpired);
                  if (disconnectOnExpired) { try { socket.disconnect(true); } catch {} }
                  cb({ result: false, message: 'tailproto.error.rekey_deadline_exceeded' });
                  return;
                }
              } catch {}
              // TailProto: 尝试检测并解封装 envelope
              try {
                const s = await TailProtoSessionRegistry.get(socket.id);
                const ed: any = eventData;
                if (s && ed && typeof ed === 'object' && (ed as any).v === 2 && typeof (ed as any).d === 'string') {
                  const nowTs = Date.now();
                  const acceptOldMs = (config as any).feature?.tailprotoRekeyAcceptOldMs ?? 30 * 1000;
                  const kvVal = Number((ed as any).kv);
                  const isCurrentKv = Number.isFinite(kvVal) && kvVal === s.kv;
                  const isPrevKv = Number.isFinite(kvVal) && kvVal === s.kv - 1;
                  const isPrevKvInWindow = isPrevKv && (nowTs - s.kvTs) <= acceptOldMs;
                  if (!(isCurrentKv || isPrevKvInWindow)) {
                    if (isPrevKv && (nowTs - s.kvTs) > acceptOldMs) {
                      try { this.broker.metrics.increment('tailproto_oldkey_expired_total', { event: String(eventName) }, 1); } catch {}
                      try { this.broker.metrics.increment('tailproto_packet_rejected_keyexpired_total', { dir: 'inbound', event: String(eventName) }, 1); } catch {}
                      try { (socket.data as any).tpKeyInvalid = true; } catch {}
                      cb({ result: false, message: 'tailproto.error.key_expired' });
                      // 可选：断开连接（灰度开关）
                      try {
                        const disconnectOnExpired = !!((config as any).feature?.tailprotoRekeyDisconnectOnExpired);
                        if (disconnectOnExpired) {
                          try { this.broker.metrics.increment('tailproto_key_invalidations_total', { reason: 'expired' }, 1); } catch {}
                          try { socket.disconnect(true); } catch {}
                        }
                      } catch {}
                    } else {
                      cb({ result: false, message: 'Invalid key version' });
                    }
                    return;
                  }
                  const seq = Number((ed as any).s);
                  const seqWindow = Number(((config as any).feature?.tailprotoSeqWindow ?? 1000) as number);
                  if (!Number.isFinite(seq)) {
                    cb({ result: false, message: 'Invalid seq' });
                    return;
                  }
                  if (seq > s.lastSeq) {
                    s.lastSeq = seq;
                  } else if (s.lastSeq - seq < seqWindow) {
                    // 允许窗口内乱序到达，接受但不前移lastSeq
                    if (process.env.TAILCHAT_SOCKET_DEBUG === 'true') {
                      try { this.logger.debug('[TailProto][seq] out-of-order accepted', { seq, lastSeq: s.lastSeq, window: seqWindow, eventName }); } catch {}
                    }
                  } else {
                    // 宽松模式：放行过窗报文但不推进 lastSeq，避免业务初始化阶段误判
                    try { this.logger.warn('[TailProto][seq] replay-window exceeded, soft-accept', { seq, lastSeq: s.lastSeq, window: seqWindow, eventName }); } catch {}
                    // 继续执行，不 return
                  }
                  if (typeof (ed as any).m === 'string' && (ed as any).m.length > 0) {
                    _tpMsgId = String((ed as any).m);
                    // 命中缓存直接返回（去重）
                    try {
                      const cacheKey = `tp:resp:${s.authKeyId}:${_tpMsgId}`;
                      const cachedRaw = await (this.redis as RedisClient.Redis).get(cacheKey);
                      if (cachedRaw) {
                        const cached = JSON.parse(cachedRaw);
                        const iv = randomIv();
                        const payloadBuf = Buffer.from(JSON.stringify(cached));
                        const { ciphertextBase64 } = await encryptPayload(s.authKey, payloadBuf, iv);
                        cb({
                          result: true,
                          data: {
                            v: 2,
                            k: s.authKeyId,
                            s: s.lastSeq,
                            kv: s.kv,
                            a: _tpMsgId,
                            iv: iv.toString('base64'),
                            d: ciphertextBase64,
                          },
                        });
                        return;
                      }
                    } catch {}
                  }
                  if (process.env.TAILCHAT_SOCKET_DEBUG === 'true') {
                    try { this.logger.debug('[TailProto][inbound] decrypt<-', eventName, JSON.stringify({ k: (ed as any).k, kv: (ed as any).kv, s: (ed as any).s, m: (ed as any).m, dLen: String((ed as any).d || '').length }).slice(0, 400)); } catch {}
                  }
                  const ivB64 = String((ed as any).iv || '');
                  const iv = Buffer.from(ivB64, 'base64');
                  // 旧钥使用次数/持续时间限制（窗口内反滥用）
                  const maxHits = Number(((config as any).feature?.tailprotoOldKeyMaxHits ?? 50) as number);
                  const maxDurMs = Number(((config as any).feature?.tailprotoOldKeyMaxDurationMs ?? 3000) as number);
                  const hits = Number(((s as any).oldKeyHits ?? 0) as number);
                  const firstAt = Number(((s as any).oldKeyFirstHitAt ?? 0) as number);
                  const withinReuseLimits = hits < maxHits && (firstAt === 0 || (nowTs - firstAt) <= maxDurMs);
                  // 是否允许使用旧钥
                  const allowUseOld = isPrevKvInWindow && !!s.oldKey && withinReuseLimits;
                  // 若不是当前 kv 且不允许用旧钥：直接拒绝并可选清理
                  if (!isCurrentKv && !allowUseOld) {
                    try { this.broker.metrics.increment('tailproto_oldkey_reuse_exceeded_total', { event: String(eventName) }, 1); } catch {}
                    try { (s as any).oldKey = undefined; (s as any).oldKeyCreatedAt = undefined; (s as any).oldKeyHits = undefined; (s as any).oldKeyFirstHitAt = undefined; } catch {}
                    cb({ result: false, message: 'tailproto.error.key_reuse_too_much' });
                    return;
                  }
                  const useOld = allowUseOld === true;
                  const keyToUse = useOld ? (s.oldKey as Buffer) : s.authKey;
                  const pt = await decryptPayload(keyToUse, String((ed as any).d), iv);
                  if (useOld) {
                    try { this.broker.metrics.increment('tailproto_oldkey_hits_total', { event: String(eventName) }, 1); } catch {}
                    try {
                      (s as any).oldKeyHits = Number(((s as any).oldKeyHits ?? 0)) + 1;
                      if (!((s as any).oldKeyFirstHitAt)) (s as any).oldKeyFirstHitAt = nowTs;
                    } catch {}
                  } else {
                    // 窗口内提前清理：一旦确认新 key 解密成功且仍存在 oldKey，立即清除
                    try {
                      if (s.oldKey) {
                        s.oldKey = undefined;
                        (s as any).oldKeyCreatedAt = undefined;
                        (s as any).oldKeyHits = undefined;
                        (s as any).oldKeyFirstHitAt = undefined;
                        try { this.broker.metrics.increment('tailproto_oldkey_cleaned_early_total', { event: String(eventName) }, 1); } catch {}
                      }
                    } catch {}
                  }
                  try {
                    eventData = JSON.parse(pt.toString('utf8'));
                  } catch {
                    eventData = pt.toString('utf8');
                  }
                  try {
                    const pv = typeof eventData === 'object' ? JSON.stringify(eventData).slice(0, 400) : String(eventData).slice(0, 400);
                    if (process.env.TAILCHAT_SOCKET_DEBUG === 'true') {
                      this.logger.debug('[TailProto][inbound] decrypt->', eventName, pv);
                    }
                  } catch {}
                }
                // 非会话明文请求：拒绝（严格模式，仅握手/必要通知放行）
                try {
                  const hasSession = !!(await TailProtoSessionRegistry.get(socket.id));
                  const allowPlainNow = ['crypt.init','crypt.resume','notify:tailproto.rekey.required'].includes(String(eventName));
                  if (!hasSession && !allowPlainNow) {
                    try { this.broker.metrics.increment('tailproto_required_rejections_total', { dir: 'inbound', event: String(eventName) }, 1); } catch {}
                    cb({ result: false, message: 'TailProto required' });
                    return;
                  }
                } catch {}
              } catch (e) {
                try { this.broker.metrics.increment('tailproto_decrypt_failures_total', {}, 1); } catch {}
                cb({ result: false, message: 'Decrypt failed' });
                return;
              }
              // WS guard: block bot endpoints on plain/any WS path as well
              if (typeof eventName === 'string' && eventName.startsWith('openapi.bot.')) {
                cb({ result: false, message: 'HTTP-only: use /api/openapi/bot/*' });
                return;
              }
              // WS guard: disallow all WS service calls from bot accounts
              if ((socket.data as any).isBot === true) {
                cb({ result: false, message: 'HTTP-only for bots: use /api/openapi/bot/*' });
                return;
              }
              
              // Guest guard: 游客仅允许极少白名单事件
              try {
                const guest = typeof (socket.data as any).userId !== 'string' || !(socket.data as any).userId;
                if (guest) {
                  const whitelist = [
                    'crypt.init',
                    'crypt.resume',
                    'user.login',
                    'user.register',
                    'user.resolveToken',
                    'user.verifyEmail',
                    'user.verifyEmailWithOTP',
                    'user.forgetPassword',
                    'user.resetPassword',
                    'user.createTemporaryUser',
                    'user.claimTemporaryUser',
                    'notify:tailproto.rekey.required',
                  ];
                  if (!whitelist.includes(String(eventName))) {
                    cb({ result: false, message: 'Unauthorized (guest)' });
                    return;
                  }
                }
              } catch {}

              // TailProto: 批量封包处理
              if (String(eventName) === 'tp.batch') {
                try {
                  const s = await TailProtoSessionRegistry.get(socket.id);
                  const items: any[] = Array.isArray(eventData) ? (eventData as any[]) : [];
                  const results: any[] = [];
                  for (const it of items) {
                    const ev = it?.ev;
                    const dd = it?.data;
                    if (typeof ev !== 'string') {
                      results.push({ ev, ok: false, message: 'Invalid event' });
                      continue;
                    }
                    try {
                      const language = parseLanguageFromHead(
                        socket.handshake.headers['accept-language']
                      );
                      const r = await this.broker.call(ev, dd, {
                        meta: { ...socket.data, socketId: socket.id, language },
                      });
                      results.push({ ev, ok: true, data: toJSONSafe(r) });
                    } catch (e: any) {
                      results.push({ ev, ok: false, message: String(e?.message || 'Service Error') });
                    }
                  }
                  if (s) {
                    const iv = randomIv();
                    const payloadBuf = Buffer.from(JSON.stringify(results ?? null));
                    const { ciphertextBase64 } = await encryptPayload(s.authKey, payloadBuf, iv);
                    cb({
                      result: true,
                      data: { v: 2, k: s.authKeyId, s: s.lastSeq, kv: s.kv, iv: iv.toString('base64'), d: ciphertextBase64 },
                    });
                  } else {
                    cb({ result: false, message: 'TailProto required' });
                  }
                } catch (e) {
                  cb({ result: false, message: 'tp.batch failed' });
                }
                return;
              }

              const endpoint = this.broker.findNextActionEndpoint(eventName);
              if (endpoint instanceof Error) {
                if (endpoint instanceof Errors.ServiceNotFoundError) {
                  throw new ServiceUnavailableError();
                }

                throw endpoint;
              }

              if (
                typeof endpoint.action.visibility === 'string' &&
                endpoint.action.visibility !== 'published'
              ) {
                throw new Errors.ServiceNotFoundError({
                  visibility: endpoint.action.visibility,
                  action: eventName,
                });
              }

              if (endpoint.action.disableSocket === true) {
                throw new Errors.ServiceNotFoundError({
                  disableSocket: true,
                  action: eventName,
                });
              }

              /**
               * TODO:
               * 这里也许还可以被优化？看molecular的源码好像没有走远程调用这一步，但是没看懂如何实现的
               * 需要研究一下
               */
              const language = parseLanguageFromHead(
                socket.handshake.headers['accept-language']
              );
              const data = await this.broker.call(eventName, eventData, {
                meta: {
                  ...socket.data,
                  socketId: socket.id,
                  language,
                },
              });
              // Login/ResolveToken success: 就地升级为已登录身份（幂等）
              try {
                const name = String(eventName || '');
                if (
                  name === 'user.login' ||
                  name === 'user.resolveToken' ||
                  name === 'user.register' ||
                  name === 'user.createTemporaryUser' ||
                  name === 'user.claimTemporaryUser'
                ) {
                  const r: any = data || {};
                  const token = r?.token || r?.jwt || (eventData && (eventData as any).token);
                  const userId = r?._id || r?.userId;
                  if (typeof token === 'string' && token.length > 0) {
                    (socket.data as any).token = token;
                  }
                  if (typeof userId === 'string' && userId.length > 0) {
                    (socket.data as any).userId = userId;
                    // 加入用户房间
                    try { socket.join(buildUserRoomId(userId)); } catch {}
                    // 在线映射
                    try {
                      await (this.redis as any).hset(buildUserOnlineKey(userId), socket.id, this.broker.nodeID);
                      await (this.redis as any).expire(buildUserOnlineKey(userId), expiredTime);
                      this.socketCloseCallbacks.push(async () => {
                        try { await (this.redis as any).hdel(buildUserOnlineKey(userId), socket.id); } catch {}
                      });
                    } catch {}
                    // TailProto 会话补写 userId，注册 rekey
                    try {
                      const sess = await TailProtoSessionRegistry.get(socket.id);
                      if (sess && !sess.userId) (sess as any).userId = userId;
                    } catch {}
                    try { (this._tpRekey as any)?.register(socket.id, userId); } catch {}
                  }
                  try {
                    const u = r;
                    if (u && (u._id || u.userId)) {
                      (socket.data as any).user = _.pick({ _id: u._id || u.userId, nickname: u.nickname, email: u.email, avatar: u.avatar }, ['_id', 'nickname', 'email', 'avatar']);
                    }
                  } catch {}
                }
              } catch {}
              // 删除事件返回后的 userId 回填逻辑：改由握手阶段完成鉴权

              if (typeof cb === 'function') {
                try {
                  const s = await TailProtoSessionRegistry.get(socket.id);
                  if (s) {
                    const iv = randomIv();
                    const safeData = toJSONSafe(data);
                    // 缓存响应，便于重传去重
                    try {
                      if (_tpMsgId) {
                        const cacheKey = `tp:resp:${s.authKeyId}:${_tpMsgId}`;
                        const ttl = Number(process.env.TAILPROTO_REPLAY_TTL_SEC || '60');
                        await (this.redis as RedisClient.Redis).set(cacheKey, JSON.stringify(safeData ?? null), 'EX', ttl);
                      }
                    } catch {}
                    const payloadBuf = Buffer.from(JSON.stringify(safeData ?? null));
                    const { ciphertextBase64 } = await encryptPayload(s.authKey, payloadBuf, iv);
                    cb({
                      result: true,
                      data: {
                        v: 2,
                        k: s.authKeyId,
                        s: s.lastSeq,
                        kv: s.kv,
                        a: _tpMsgId,
                        iv: iv.toString('base64'),
                        d: ciphertextBase64,
                      },
                    });
                  } else {
                    cb({ result: false, message: 'TailProto required' });
                  }
                } catch (serializationError) {
                  cb({ result: false, message: `Serialization failed: ${String(serializationError)}` });
                }
              }
            } catch (err: unknown) {
              const message = _.get(err, 'message', 'Service Error');
              this.logger.debug('[SocketIO]', eventName, '=>', message);
              this.logger.error('[SocketIO]', err);
              
              try {
                const safeMessage = typeof message === 'string' ? message : String(message);
                cb({
                  result: false,
                  message: safeMessage,
                });
              } catch (serializationError) {
                cb({
                  result: false,
                  message: 'Service Error (serialization failed)',
                });
              }
            }
          }
        );
      });
    },
    async stopped(this: SocketIOService) {
      if (this.io) {
        this.io.close();
        await Promise.all(this.socketCloseCallbacks.map((fn) => fn()));
      }
      try { await stopTailProtoConsumers(this.logger); } catch {}
      try { await stopProducer(); } catch {}
      this.logger.info('断开所有连接');
    },
    actions: {
      joinRoom: {
        visibility: 'public',
        params: {
          roomIds: 'array',
          userId: [{ type: 'string', optional: true }], // 可选, 如果不填则为当前socket的id
        },
        async handler(
          this: SocketIOService,
          ctx: TcContext<{ roomIds: string[]; userId?: string }>
        ) {
          const roomIds = ctx.params.roomIds;
          const userId = ctx.params.userId;
          const searchId = isValidStr(userId)
            ? buildUserRoomId(userId)
            : ctx.meta.socketId;
          if (typeof searchId !== 'string') {
            throw new Error(
              'Unable to join the room, the query condition is invalid, please contact the administrator'
            );
          }

          if (!Array.isArray(roomIds)) {
            throw new Error(
              'Unable to join the room, the parameter must be an array'
            );
          }

          // 获取远程socket链接并加入
          const io: SocketServer = this.io;
          const remoteSockets = await io.in(searchId).fetchSockets();
          if (remoteSockets.length === 0) {
            this.logger.warn(
              'Unable to join the room, unable to find the current socket link:',
              searchId
            );
            return;
          }

          remoteSockets.forEach((rs) =>
            rs.join(
              roomIds.map(String) // 强制确保roomId为字符串，防止出现传个objectId类型的数据过来
            )
          );
        },
      },
      leaveRoom: {
        visibility: 'public',
        params: {
          roomIds: 'array',
          userId: [{ type: 'string', optional: true }],
        },
        async handler(
          this: SocketIOService,
          ctx: TcContext<{ roomIds: string[]; userId?: string }>
        ) {
          const roomIds = ctx.params.roomIds;
          const userId = ctx.params.userId;
          const searchId = isValidStr(userId)
            ? buildUserRoomId(userId)
            : ctx.meta.socketId;
          if (typeof searchId !== 'string') {
            this.logger.error(
              'Unable to leave the room, the current socket connection does not exist'
            );
            return;
          }

          // 获取远程socket链接并离开
          const io: SocketServer = this.io;
          const remoteSockets = await io.in(searchId).fetchSockets();
          if (remoteSockets.length === 0) {
            this.logger.error(
              `Can't leave room, can't find current socket link`
            );
            return;
          }

          remoteSockets.forEach((rs) => {
            roomIds.forEach((roomId) => {
              rs.leave(roomId);
            });
          });
        },
      },

      /**
       * 根据userId获取所有的用户链接
       */
      fetchUserSocketIds: {
        visibility: 'public',
        params: {
          userId: 'string',
        },
        async handler(
          this: SocketIOService,
          ctx: TcContext<{ userId: string }>
        ): Promise<string[]> {
          const userId = ctx.params.userId;
          const io: SocketServer = this.io;
          const remoteSockets = await io
            .in(buildUserRoomId(userId))
            .fetchSockets();

          return remoteSockets.map((remoteSocket) => remoteSocket.id);
        },
      },

      /**
       * 获取userId获取所有的用户的token
       */
      getUserSocketToken: {
        visibility: 'public',
        params: {
          userId: 'string',
        },
        async handler(
          this: SocketIOService,
          ctx: TcContext<{ userId: string }>
        ): Promise<string[]> {
          const userId = ctx.params.userId;
          const io: SocketServer = this.io;
          const remoteSockets = await io
            .in(buildUserRoomId(userId))
            .fetchSockets();

          return remoteSockets.map((remoteSocket) => remoteSocket.data.token);
        },
      },

      /**
       * 踢出用户
       */
      tickUser: {
        visibility: 'public',
        params: {
          userId: 'string',
        },
        async handler(this: SocketIOService, ctx: TcContext<{ userId: string }>) {
          const userId = ctx.params.userId;
          const io: SocketServer = this.io;
          const remoteSockets = await io
            .in(buildUserRoomId(userId))
            .fetchSockets();

          remoteSockets.forEach((remoteSocket) => {
            remoteSocket.disconnect(true);
          });
        },
      },

      /**
       * 服务端通知
       */
      notify: {
        visibility: 'public',
        params: {
          type: 'string',
          target: [
            { type: 'string', optional: true },
            { type: 'array', optional: true },
          ],
          eventName: 'string',
          eventData: 'any',
        },
        handler(
          this: SocketIOService,
          ctx: PureContext<{
            type: string;
            target: string | string[];
            eventName: string;
            eventData: any;
          }>
        ) {
          const { type, target, eventName, eventData } = ctx.params;
          const finalEventName = eventName.startsWith('notify:')
            ? eventName
            : `notify:${eventName}`;
          const io: SocketServer = this.io;
          const sendToSockets = async (sockets: any[]) => {
            this.logger.info('[SocketIO Debug] sendToSockets called', {
              type,
              target,
              finalEventName,
              socketsCount: sockets.length,
              socketIds: sockets.map(s => s.id)
            });
            
            for (const s of sockets) {
              try {
                // TailProto: 针对已握手连接进行下行加密
                const sess = await TailProtoSessionRegistry.get(s.id);
                const apw2 = (config as any).feature?.tailprotoAllowPlainWhitelist || process.env.TAILPROTO_ALLOW_PLAIN_WHITELIST || 'crypt.init,notify:tailproto.rekey.required,user.login,user.register,user.resolveToken';
                const allowPlainList = String(apw2)
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean);
                const isWhitelisted = allowPlainList.includes(finalEventName);
                
                this.logger.info('[SocketIO Debug] Processing socket', {
                  socketId: s.id,
                  hasSession: !!sess,
                  isWhitelisted,
                  finalEventName
                });
                
                if (sess && !isWhitelisted) {
                  const iv = randomIv();
                  const payloadBuf = Buffer.from(JSON.stringify(toJSONSafe(eventData) ?? null));
                  const { ciphertextBase64 } = await encryptPayload(sess.authKey, payloadBuf, iv);
                  
                  this.logger.info('[SocketIO Debug] Sending encrypted message', {
                    socketId: s.id,
                    authKeyId: sess.authKeyId,
                    lastSeq: sess.lastSeq,
                    kv: sess.kv
                  });
                  
                  s.emit(finalEventName, {
                    v: 2,
                    k: sess.authKeyId,
                    s: sess.lastSeq,
                    kv: sess.kv,
                    iv: iv.toString('base64'),
                    d: ciphertextBase64,
                  });
                } else {
                  if (isWhitelisted) {
                    this.logger.info('[SocketIO Debug] Sending whitelisted plaintext message', {
                      socketId: s.id,
                      finalEventName
                    });
                    const safeData = toJSONSafe(eventData);
                    s.emit(finalEventName, safeData);
                  } else {
                    this.logger.warn('[SocketIO Debug] Message rejected - no session and not whitelisted', {
                      socketId: s.id,
                      finalEventName,
                      hasSession: !!sess,
                      isWhitelisted
                    });
                    try { this.broker.metrics.increment('tailproto_required_rejections_total', { dir: 'notify', event: finalEventName }, 1); } catch {}
                    // 严禁明文下发，直接跳过
                  }
                }
              } catch (serializationError) {
                this.logger.error('[SocketIO Debug] Serialization error', {
                  socketId: s.id,
                  finalEventName,
                  error: String(serializationError)
                });
                s.emit(finalEventName, { error: 'Serialization failed', message: String(serializationError) });
              }
            }
          };

          if (type === 'unicast' && typeof target === 'string') {
            const room = buildUserRoomId(target);
            this.logger.info('[SocketIO Debug] Unicast to user room', {
              userId: target,
              room,
              finalEventName
            });
            io.in(room).fetchSockets().then(async (sockets: any[]) => {
              this.logger.info('[SocketIO Debug] Fetched sockets for user room', {
                userId: target,
                room,
                socketsCount: sockets?.length || 0,
                socketIds: sockets?.map(s => s.id) || []
              });
              
              if (sockets && sockets.length > 0) {
                return sendToSockets(sockets);
              }
              // 不再进行全量遍历回退：若未加入房间则视为未在线/未鉴权
              this.logger.warn('[SocketIO Debug] No sockets found in user room', {
                userId: target,
                room,
                finalEventName
              });
              return;
            });
          } else if (type === 'listcast' && Array.isArray(target)) {
            const rooms = target.map((t) => buildUserRoomId(t));
            io.in(rooms).fetchSockets().then(sendToSockets);
          } else if (type === 'roomcast') {
            io.in(target).fetchSockets().then(sendToSockets);
          } else if (type === 'broadcast') {
            io.fetchSockets().then(sendToSockets);
          } else {
            this.logger.warn('[SocketIO]', 'Unknown notify type or target', type, target);
          }
        },
      },

      /**
       * 检查用户在线状态
       */
      checkUserOnline: {
        params: {
          userIds: 'array',
        },
        async handler(
          this: SocketIOService,
          ctx: PureContext<{ userIds: string[] }>
        ) {
          const userIds = ctx.params.userIds;

          const status = await Promise.all(
            userIds.map((userId) =>
              (this.redis as RedisClient.Redis).exists(
                buildUserOnlineKey(userId)
              )
            )
          );

          return status.map((d) => Boolean(d));
        },
      },
    },
    methods: {
      initSocketIO() {
        if (!this.server) {
          throw new Errors.ServiceNotAvailableError(
            'Need to use with [ApiGatewayMixin]'
          );
        }
        this.io = new SocketServer(this.server, {
          serveClient: false,
          transports: ['websocket'],
          cors: {
            origin: '*',
            methods: ['GET', 'POST'],
          },
          parser: options.disableMsgpack ? undefined : msgpackParser,
        });

        if (
          isValidStr(process.env.ADMIN_USER) &&
          isValidStr(process.env.ADMIN_PASS)
        ) {
          this.logger.info('****************************************');
          this.logger.info(`Detected that Admin management is enabled`);
          this.logger.info('****************************************');

          try {
            instrument(this.io, {
              auth: {
                type: 'basic',
                username: process.env.ADMIN_USER,
                password: bcrypt.hashSync(process.env.ADMIN_PASS, 10),
              },
            });
          } catch (e) {
            this.logger.warn('[Socket AdminUI] disabled due to initialization error:', String(e));
          }
        }
      },
    },
  };

  return schema;
};