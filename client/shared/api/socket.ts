import { io, Socket } from 'socket.io-client';
import _isNil from 'lodash/isNil';
import { getServiceUrl } from '../manager/service';
import { isDevelopment } from '../utils/environment';
import { showErrorToasts, showGlobalLoading, showToasts } from '../manager/ui';
import { t } from '../i18n';
import { sharedEvent } from '../event';
import msgpackParser from 'socket.io-msgpack-parser';
import { getGlobalConfig } from '../model/config';
import { tokenGetter } from '../manager/request';
import type { ClientSessionState, TailProtoEnvelope } from '../crypto/tailproto';
import { clientHandshakeInit, encryptEnvelope, decryptEnvelope } from '../crypto/tailproto';

// 调试预览，避免打印过大对象
function _preview(obj: any, max: number = 400): string {
  try {
    const s = JSON.stringify(obj);
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch {
    const s = String(obj);
    return s.length > max ? s.slice(0, max) + '…' : s;
  }
}

// 允许明文的控制类白名单（仅握手/控制面/登录前置）
function _isPlainWhitelist(eventName: string): boolean {
  const name = String(eventName || '');
  return (
    name === 'crypt.init' ||
    name === 'crypt.resume' ||
    name === 'notify:tailproto.rekey.required'
  );
}

// 运行时跨 bundle 单例：在 globalThis/window/global 上共享 socket 实例，避免多份 "单例"
const GLOBAL_SOCKET_STATE_KEY = '__TC_SOCKET_STATE__';
function getGlobalObj(): any {
  // globalThis 优先，其次 window/global，最后回退到一个可扩展的对象
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (typeof globalThis !== 'undefined') return globalThis as any;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (typeof window !== 'undefined') return window as any;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (typeof global !== 'undefined') return global as any;
  return {} as any;
}
type SharedSocketState = {
  socket?: Socket;
  appSocket?: AppSocket | null;
  creating?: Promise<AppSocket> | null;
};
function getSharedSocketState(): SharedSocketState {
  const g = getGlobalObj();
  if (!g[GLOBAL_SOCKET_STATE_KEY]) {
    g[GLOBAL_SOCKET_STATE_KEY] = {} as SharedSocketState;
  }
  return g[GLOBAL_SOCKET_STATE_KEY] as SharedSocketState;
}

class SocketEventError extends Error {
  name = 'SocketEventError';
}

type SocketEventRespones<T = unknown> =
  | {
      result: true;
      data: T;
    }
  | {
      result: false;
      message: string;
    };

/**
 * 封装后的 Socket
 */
export class AppSocket {
  private listener: [string, (data: unknown) => void][] = [];
  private lastActivityAt: number = 0;
  public readonly hasAuthToken: boolean;
  private tpState: ClientSessionState | null = null;
  private tpEnabled: boolean = false;
  private batchQueue: Array<{ en: string; ed: any; resolve: (v: any)=>void; reject: (e: any)=>void }> = [];
  private batchTimer: any = null;
  private retired: boolean = false;
  private rekeyInFlight: boolean = false;
  private tpReinitCooldownAt: number = 0;
  private readyResolvers: Array<() => void> = [];
  private isReady: boolean = false;
  private reauthCooldownAt: number = 0;

  constructor(private socket: Socket, hasAuthToken = false) {
    this.hasAuthToken = !!hasAuthToken;
    socket.onAny(async (eventName: string, data: any) => {
      if (this.retired) return;

      // 统一通知通道：服务器发出 'notify' + envelope，这里解密并分发到 notify:* 监听
      if (eventName === 'notify') {
        try {
          if (this.tpState && data && typeof data === 'object' && (data as any).v === 2) {
            const plain = await decryptEnvelope(this.tpState, data as any);
            const innerEv = String(plain?.ev || '');
            let innerData = plain?.data;
            // 如果内层数据仍是 envelope，则再次解密
            try {
              if (innerData && typeof innerData === 'object' && (innerData as any).v === 2) {
                innerData = await decryptEnvelope(this.tpState, innerData as any);
              }
            } catch {}
            if (innerEv) {
              const fullEv = innerEv.startsWith('notify:') ? innerEv : `notify:${innerEv}`;
              const matched = this.listener.filter(([ev]) => ev === fullEv);
              matched.forEach(([, cb]) => cb(innerData));
            }
          }
        } catch (e) {
          console.warn('[Socket][notify] decrypt failed:', (e as Error)?.message);
        }
        return;
      }

      const matched = this.listener.filter(([ev]) => ev === eventName); // 匹配到的监听器列表
      if (matched.length === 0) {
        // 没有匹配到任何处理函数
        console.warn(`[Socket IO] Unhandler event: ${eventName}`, data);
        return;
      }
      // TailProto: 解包 notify 加密负载（只要有会话并检测到 envelope 就尝试解密）
      try {
        if (this.tpState && data && typeof data === 'object' && (data as any).v === 2) {
          let plain: any;
          try {
            plain = await decryptEnvelope(this.tpState, data as any);
          } catch (e) {
            try { console.warn('[Socket][notify] decrypt failed, try reinit once'); } catch {}
            await this.maybeReinitOnDecryptFail();
            throw e;
          }
          data = plain;
        }
      } catch (e) {
        console.warn('[Socket] TailProto notify decrypt failed:', (e as Error)?.message);
      }
      // 非白名单事件若不是 envelope 且当前无会话，则直接丢弃（禁止明文入站）
      if (!this.tpState && !(data && typeof data === 'object' && (data as any).v === 2) && !_isPlainWhitelist(eventName)) {
        try { console.warn('[Socket] Drop plaintext notify (TailProto required):', eventName); } catch {}
        return;
      }
      matched.forEach(([, cb]) => cb(data));
    });

    // 断开时清理所有监听器，并重置就绪态
    this.socket.on('disconnect', () => {
      try { this.isReady = false; } catch {}
    });

    // 内置监听：rekey 通知（明文白名单）
    try {
      // 避免在 onAny 中打印未处理日志
      try { this.listen('notify:tailproto.rekey.required', () => {}); } catch {}
      this.socket.on('notify:tailproto.rekey.required', async (payload?: any) => {
        if (this.retired) return;
        if (!this.tpEnabled) return;
        if (this.rekeyInFlight) return;
        this.rekeyInFlight = true;
        try {
          // 强制 re-init：跳过 resume，确保生成新 authKey（authKeyId/kv 均更新）
          await this.forceReinitTailProtoSession();
        } catch (e) {
          try { console.warn('[Socket][rekey] force init failed:', (e as Error)?.message); } catch {}
        } finally {
          this.rekeyInFlight = false;
        }
      });
    } catch {}

    // 在底层 socket 重连后，尝试恢复 TailProto 会话
    try {
      this.socket.io.on('reconnect', async () => {
        try { this.isReady = false; } catch {}
        try {
          await this.resumeTailProtoSession();
        } catch {}
        // TailProto 会话恢复后，若存在本地 token，则通过加密通道补充鉴权
        try { await this.reauthWithTokenIfAvailable(); } catch {}
        this.markReady();
      });
    } catch {}
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  // 连接事件辅助
  onConnect(cb: () => void) {
    this.socket.on('connect', cb);
  }
  onceConnect(cb: () => void) {
    this.socket.once('connect', cb);
  }

  private waitUntilConnected(timeoutMs = 12000): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (err?: any) => {
        cleanup();
        reject(err || new Error('Socket connect error'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Socket connect timeout'));
      }, timeoutMs);
      const poll = setInterval(() => {
        if (this.connected) {
          cleanup();
          resolve();
        }
      }, 150);
      const cleanup = () => {
        try { this.socket.off('connect', onConnect); } catch {}
        try { this.socket.off('connect_error', onError as any); } catch {}
        try { this.socket.io?.off('reconnect', onConnect as any); } catch {}
        try { clearTimeout(timer); } catch {}
        try { clearInterval(poll); } catch {}
      };
      this.socket.once('connect', onConnect);
      this.socket.once('connect_error', onError as any);
      // 若正在重连，监听一次成功事件（Manager）
      try { this.socket.io?.once('reconnect', onConnect as any); } catch {}
    });
  }

  /**
   * 标记为退休：忽略后续回调并断开底层 socket
   */
  retire() {
    this.retired = true;
    try { this.socket.disconnect(); } catch {}
  }

  /** 等待连接就绪（含 TailProto 恢复） */
  async waitReady(): Promise<void> {
    if (this.isReady) return;
    await new Promise<void>((resolve) => this.readyResolvers.push(resolve));
  }

  private markReady() {
    if (this.isReady) return;
    this.isReady = true;
    const resolvers = this.readyResolvers.splice(0, this.readyResolvers.length);
    resolvers.forEach((fn) => {
      try { fn(); } catch {}
    });
  }

  /** 若本地存在 token，则通过加密通道补充鉴权（用于初次连接与重连后恢复鉴权态） */
  private async reauthWithTokenIfAvailable(): Promise<void> {
    // 10s 冷却，避免高频重连时重复鉴权
    const now = Date.now();
    if (now - this.reauthCooldownAt < 10_000) return;
    this.reauthCooldownAt = now;
    try {
      const tok = await tokenGetter();
      if (typeof tok === 'string' && tok.length > 0) {
        try {
          // 通过加密通道发送 token 完成鉴权
          await this.request('user.resolveToken', { token: tok });
          // 标记为已鉴权，避免被误判为游客连接
          (this as any).hasAuthToken = true;
        } catch (e) {
          // 忽略失败，保持现状；后续业务请求仍可能携带 token 完成鉴权
        }
      }
    } catch {}
  }

  /** 在重连后尝试使用 resumeToken 恢复 TailProto 会话 */
  private async resumeTailProtoSession(): Promise<void> {
    if (!this.tpEnabled) return;
    const cfg = getGlobalConfig();
    const wantTp = (!!cfg.tailprotoPreferred && !cfg.tailprotoRequired) || !!cfg.tailprotoRequired;
    // 先尝试 resume
    let resumed = false;
    if (this.tpState) {
      const token = (this.tpState as any).resumeToken as string | undefined;
      if (token) {
        await new Promise<void>((resolve) => {
          try {
            this.socket.emit('crypt.resume', { token }, (resp: any) => {
              if (resp && resp.result === true) {
                try {
                  const data = resp.data || {};
                  if (typeof data.kv === 'number') (this.tpState as any).kv = Number(data.kv);
                  this.lastActivityAt = Date.now();
                  resumed = true;
                } catch {}
              }
              resolve();
            });
          } catch {
            resolve();
          }
        });
      }
    }
    if (resumed) return;
    // resume 失败，若仍期望加密，则重新 init
    if (!wantTp) {
      this.tpEnabled = false;
      return;
    }
    try {
      const st: any = { seq: 0 } as ClientSessionState;
      const rawRequest = async (ev: string, data: any) => {
        return await new Promise<any>((resolve, reject) => {
          this.socket.emit(ev, data, (resp: any) => {
            if (resp && resp.result === true) resolve(resp.data);
            else reject(new Error(resp?.message || 'Handshake failed'));
          });
        });
      };
      await clientHandshakeInit(st, rawRequest);
      (this as any)['tpState'] = st;
      this.tpEnabled = true;
      try { console.log('[Socket] TailProto re-init done after resume failure', { kv: st.kv, authKeyId: st.authKeyId?.slice(0, 8) }); } catch {}
    } catch {
      // 彻底失败，降级明文
      this.tpEnabled = false;
    }
  }

  /** 强制重新握手：用于 rekey 通知后的密钥轮换（不走 resume） */
  private async forceReinitTailProtoSession(): Promise<void> {
    if (!this.tpEnabled) return;
    const st: any = { seq: 0 } as ClientSessionState;
    const rawRequest = async (ev: string, data: any) => {
      return await new Promise<any>((resolve, reject) => {
        this.socket.emit(ev, data, (resp: any) => {
          if (resp && resp.result === true) resolve(resp.data);
          else reject(new Error(resp?.message || 'Handshake failed'));
        });
      });
    };
    await clientHandshakeInit(st, rawRequest);
    (this as any)['tpState'] = st;
    this.tpEnabled = true;
  }

  /** 在解密失败时触发一次 re-init（带冷却） */
  private async maybeReinitOnDecryptFail(): Promise<void> {
    const now = Date.now();
    const cooldown = 10 * 1000; // 10s 冷却
    if (now - this.tpReinitCooldownAt < cooldown) return;
    this.tpReinitCooldownAt = now;
    try { await this.forceReinitTailProtoSession(); } catch {}
  }

  async request<T = unknown>(
    eventName: string,
    eventData: unknown = {}
  ): Promise<T> {
    // 在发起请求前确保连接就绪，降低断线期间超时概率
    try {
      if (!this.connected) {
        await this.waitUntilConnected(7000);
      }
      // 若需要加密且会话尚未就绪，则等待握手完成，避免明文回退
      if (!_isPlainWhitelist(eventName) && this.tpEnabled && !this.tpState) {
        try { await this.waitReady(); } catch {}
      }
    } catch (e) {
      throw new SocketEventError((e as Error)?.message || 'Socket not connected');
    }
    const cfg = getGlobalConfig();
    const batchEnabled = !!cfg.tailprotoBatchEnabled && eventName !== 'crypt.init';
    if (batchEnabled) {
      return await new Promise<T>((resolve, reject) => {
        this.batchQueue.push({ en: eventName, ed: eventData, resolve, reject });
        const maxDelay = (cfg.tailprotoBatchMaxDelayMs ?? 15) as number;
        const maxItems = (cfg.tailprotoBatchMaxItems ?? 10) as number;
        if (!this.batchTimer || this.batchQueue.length >= maxItems) {
          try { if (this.batchTimer) clearTimeout(this.batchTimer); } catch {}
          this.batchTimer = setTimeout(() => {
            this.flushBatch();
          }, Math.max(1, maxDelay));
        }
      });
    }

    const doEmit = (en: string, ed: unknown) =>
      new Promise<T>(async (resolve, reject) => {
        if (this.retired) { return reject(new SocketEventError('Socket retired')); }
        this.lastActivityAt = Date.now();
        let attempts = 0;
        let retriedOnRekey = false;
        const timeoutMs = (getGlobalConfig().tailprotoRetransmitTimeoutMs ?? 7000) as number;
        const sendOnce = async () => {
          attempts += 1;
          // TailProto: 若启用则封包
          let payloadToSend: any = ed;
          // 非白名单事件禁止明文发送
          if (!_isPlainWhitelist(en)) {
            if (!this.tpState) return reject(new SocketEventError('TailProto required'));
            try {
              payloadToSend = await encryptEnvelope(this.tpState, { ev: en, data: ed });
            } catch (e) {
              return reject(new SocketEventError('Encrypt failed'));
            }
          }
          let done = false;
          let timer: any = null;
          const clear = () => { try { if (timer) clearTimeout(timer); } catch {} };
          const onAck = async (resp: any) => {
            if (this.retired) { clear(); return; }
            if (done) return; done = true; clear();
            try {
              if (resp.result === true) {
                this.lastActivityAt = Date.now();
                let data = resp.data as any;
                try {
                  if (this.tpState && data && typeof data === 'object' && (data as any).v === 2) {
                    data = await decryptEnvelope(this.tpState, data as any);
                  }
                } catch (e) {
                  try { console.warn('[Socket][ack] decrypt failed, try reinit once'); } catch {}
                  try { await this.maybeReinitOnDecryptFail(); } catch {}
                  return reject(new SocketEventError('Decrypt failed'));
                }
                resolve(data as T);
                return;
              }
              if (resp.result === false) {
                if (this.retired) return;
                const msg = String(resp?.message || '');
                const needReinit = this.tpEnabled && !retriedOnRekey && (
                  msg === 'tailproto.error.rekey_deadline_exceeded' ||
                  msg === 'tailproto.error.key_expired' ||
                  msg === 'TailProto required'
                );
                if (needReinit) {
                  try { await this.forceReinitTailProtoSession(); } catch {}
                  retriedOnRekey = true;
                  // retry once
                  sendOnce();
                  return;
                }
                reject(new SocketEventError(msg || '请求失败'));
                return;
              }
              reject(new Error('Invalid ACK'));
            } catch (e) {
              reject(e);
            }
          };
          timer = setTimeout(() => {
            if (done) return; done = true;
            // 超时重发（最多一次）
            if (this.tpEnabled && attempts < 2) {
              sendOnce();
            } else {
              reject(new SocketEventError('ACK timeout'));
            }
          }, timeoutMs);
          this.socket.emit('tp.invoke', payloadToSend, onAck);
        };
        await sendOnce();
      });

    return await doEmit(eventName, eventData);
  }

  private async flushBatch() {
    const cfg = getGlobalConfig();
    const maxItems = (cfg.tailprotoBatchMaxItems ?? 10) as number;
    const items = this.batchQueue.splice(0, Math.max(1, maxItems));
    this.batchTimer = null;
    if (items.length === 0) return;
    // 构建批量负载
    const payload = items.map((it) => ({ ev: it.en, data: it.ed }));
    // 发送并映射 ACK
    const sendBatch = () => new Promise<any>(async (resolve, reject) => {
      let payloadToSend: any = payload;
      try {
        // 若需要加密但会话未就绪，等待握手完成
        if (!this.tpState && this.tpEnabled) {
          try { await this.waitReady(); } catch {}
        }
        // 批量通道不在白名单，必须加密
        if (!this.tpState) return reject(new SocketEventError('TailProto required'));
        payloadToSend = await encryptEnvelope(this.tpState, { ev: 'tp.batch', data: payload });
      } catch (e) {
        return reject(new SocketEventError('Encrypt failed'));
      }
      this.socket.emit('tp.invoke', payloadToSend, async (resp: any) => {
        try {
          if (resp.result === true) {
            let data = resp.data as any;
            if (this.tpState && data && typeof data === 'object' && (data as any).v === 2) {
              data = await decryptEnvelope(this.tpState, data as any);
            }
            resolve(data);
            return;
          }
          reject(new SocketEventError(resp.message || '批量请求失败'));
        } catch (e) {
          reject(e);
        }
      });
    });
    try {
      const results = await sendBatch();
      if (Array.isArray(results) && results.length === items.length) {
        results.forEach((r: any, idx: number) => {
          const it = items[idx];
          if (r && r.ok) it.resolve(r.data);
          else it.reject(new SocketEventError(r?.message || '请求失败'));
        });
      } else {
        // 结构异常，全部按失败处理
        items.forEach((it) => it.reject(new SocketEventError('批量响应异常')));
      }
    } catch (e: any) {
      items.forEach((it) => it.reject(e));
    }
  }

  /**
   * 监听远程通知
   * @returns cleanup function to remove the listener
   */
  listen<T>(eventName: string, callback: (data: T) => void): () => void {
    // 检查事件名是否已经包含notify:前缀，避免重复添加
    const fullEventName = eventName.startsWith('notify:') ? eventName : `notify:${eventName}`;
    const listenerItem: [string, (data: unknown) => void] = [fullEventName, callback as any];

    // 去重：避免在开发模式/组件重复挂载时造成重复监听（导致 Toast 显示两次等问题）
    const exists = this.listener.some((it) => it[0] === fullEventName && it[1] === (callback as any));
    if (!exists) {
      this.listener.push(listenerItem);
    }
    
    // 返回清理函数，使用数组引用直接删除，避免函数比较问题
    return () => {
      const index = this.listener.indexOf(listenerItem);
      if (index >= 0) {
        this.listener.splice(index, 1);
      }
    };
  }

  /**
   * 移除监听函数
   */
  removeListener(eventName: string, callback: (data: any) => void) {
    // 检查事件名是否已经包含notify:前缀，避免重复添加
    const fullEventName = eventName.startsWith('notify:') ? eventName : `notify:${eventName}`;
    const index = this.listener.findIndex(
      (item) => item[0] === fullEventName && item[1] === callback
    );
    if (index >= 0) {
      this.listener.splice(index, 1);
    }
  }

  /**
   * 模拟重连
   * NOTICE: 仅用于开发环境
   */
  mockReconnect() {
    this.socket.disconnect();
    showToasts(t('k_socket_mock_reconnect')); // 5秒后重连
    setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      this.socket.io.skipReconnect = false;
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      this.socket.io.reconnect();
    }, 5 * 1000);
  }

  /**
   * 断线重连后触发
   */
  onReconnect(cb: () => void) {
    this.socket.io.on('reconnect', cb);
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.socket.disconnect();
  }

  /**
   * 初始Socket状态管理提示
   */
  private closeFn: unknown = null; // 全局loading关闭函数
  setupSocketStatusTip() {
    const socket = this.socket;

    const showConnecting = () => {
      if (this.closeFn) {
        return;
      }
      this.closeFn = showGlobalLoading(t('正在重新链接'));
    };

    const closeConnecting = () => {
      if (this.closeFn && typeof this.closeFn === 'function') {
        this.closeFn();
        this.closeFn = null;
      }
    };

    // 网络状态管理
    socket.on('connect', () => {
      console.log('连接成功');
      closeConnecting();

      sharedEvent.emit('updateNetworkStatus', 'connected');
    });
    socket.on('connecting', (data) => {
      console.log('正在连接');

      showConnecting();

      sharedEvent.emit('updateNetworkStatus', 'reconnecting');
    });
    socket.on('disconnect', (data) => {
      closeConnecting();
      sharedEvent.emit('updateNetworkStatus', 'disconnected');
    });
    socket.on('connect_error', (data) => {
      closeConnecting();
      sharedEvent.emit('updateNetworkStatus', 'disconnected');
    });

    socket.io.on('reconnect', (data) => {
      closeConnecting();
      sharedEvent.emit('updateNetworkStatus', 'connected');
    });
    socket.io.on('reconnect_attempt', (data) => {
      console.log('重连中...');
      showConnecting();
      sharedEvent.emit('updateNetworkStatus', 'reconnecting');
    });
    socket.io.on('reconnect_error', () => {
      showConnecting();
      sharedEvent.emit('updateNetworkStatus', 'reconnecting');
    });
    socket.io.on('reconnect_failed', () => {
      showConnecting();
      sharedEvent.emit('updateNetworkStatus', 'disconnected');
    });
    socket.io.on('error', (error) => {
      closeConnecting();
      sharedEvent.emit('updateNetworkStatus', 'disconnected');
    });
  }
}

let _socket: Socket = (getSharedSocketState().socket as any) as Socket;
let _appSocket: AppSocket | null = getSharedSocketState().appSocket ?? null;
let _creatingSocketPromise: Promise<AppSocket> | null = getSharedSocketState().creating ?? null;

/**
 * 获取当前的 AppSocket 实例
 * 用于在其他模块中访问 socket
 */
export function getGlobalSocket(): AppSocket | null {
  const shared = getSharedSocketState();
  const socket = shared.appSocket ?? _appSocket;
  
  // 调试信息 - 临时移除减少日志
  // console.debug('[getGlobalSocket] Returning socket:', ...);
  
  return socket;
}

/**
 * 创建Socket连接
 * 如果已经有Socket连接则关闭上一个
 * @param token Token
 */
export function createSocket(token?: string, opts?: { allowGuest?: boolean }): Promise<AppSocket> {
  const shared = getSharedSocketState();
  
  
  if (shared.appSocket && shared.appSocket.connected) {
    return Promise.resolve(shared.appSocket);
  }
  if (shared.creating) return shared.creating;
  if (_creatingSocketPromise) return _creatingSocketPromise;
  if (!_isNil(_socket)) {
    try { _socket.close(); } catch {}
  }

  _creatingSocketPromise = new Promise((resolve, reject) => {
    (async () => {
      const cfg0 = getGlobalConfig();
      const disableMsgpack = cfg0.disableMsgpack;
      const auth: any = {};

      // 优先使用外部传入 token；若不存在，则尝试从全局 tokenGetter 获取
      let finalToken: string | undefined = token;
      try {
        if (!(typeof finalToken === 'string' && finalToken.length > 0)) {
          const got = await tokenGetter();
          if (typeof got === 'string' && got.length > 0) {
            finalToken = got;
          }
        }
      } catch {}

      console.debug('[Socket] Client Auth Debug', {
        tokenProvided: !!token,
        tokenType: typeof token,
        tokenLength: token?.length || 0,
        tokenPreview: token ? `${token.substring(0, 20)}...` : 'null',
        resolvedTokenUsed: typeof finalToken === 'string' && finalToken.length > 0,
      });

      const useDeferredAuth = !!cfg0.tailprotoPreferred || !!cfg0.tailprotoRequired;
      const usingDeferredWithToken = !!useDeferredAuth && typeof finalToken === 'string' && finalToken.length > 0;
      let hasAuthTokenAtHandshake = false;
      if (!useDeferredAuth && typeof finalToken === 'string' && finalToken.length > 0) {
        auth.token = finalToken;
        hasAuthTokenAtHandshake = true;
        console.debug('[Socket] Token added to auth object');
      } else {
        // 无 token：根据 allowGuest 决定是否允许游客握手
        if (!(typeof finalToken === 'string' && finalToken.length > 0)) {
          const allowGuest = !!(opts && (opts as any).allowGuest);
          if (!allowGuest) {
            throw new Error('Auth required for WebSocket');
          }
        }
      }

      // 若未在握手中携带 token，但本地存在 token 且启用延迟鉴权，则允许先握手再加密补鉴权
      // 否则需显式允许游客
      if (!(typeof auth.token === 'string' && auth.token.length > 0)) {
        const allowGuest = !!(opts && (opts as any).allowGuest);
        if (!allowGuest && !usingDeferredWithToken) throw new Error('Auth required for WebSocket');
      }

      console.debug('[Socket] Creating connection to:', getServiceUrl(), 'with auth:', {
        hasToken: !!auth.token,
        authKeys: Object.keys(auth),
      });

      console.debug('[Socket] Client Config:', {
        disableMsgpack,
        usingMsgpack: !disableMsgpack,
        parser: disableMsgpack ? 'default' : 'msgpack',
      });

      _socket = io(getServiceUrl(), {
        transports: ['websocket'],
        auth,
        forceNew: true,
        parser: disableMsgpack ? undefined : msgpackParser,
      });
      // 将原始 socket 暂存到共享状态（仅作参考，不鼓励外部直接使用）
      try {
        const s = getSharedSocketState();
        s.socket = _socket;
        s.creating = _creatingSocketPromise;
      } catch {}
      _socket.once('connect', async () => {
        // 连接成功
        const appSocket = new AppSocket(_socket, hasAuthTokenAtHandshake);
        appSocket.setupSocketStatusTip();
        // TailProto: 按首选项进行握手（可回退）
        try {
          const cfg = getGlobalConfig();
          appSocket['tpEnabled'] = !!cfg.tailprotoPreferred && !cfg.tailprotoRequired ? true : !!cfg.tailprotoRequired;
          if (appSocket['tpEnabled']) {
            const st: any = { seq: 0 } as ClientSessionState;
            const rawRequest = async (ev: string, data: any) => {
              return await new Promise<any>((resolve, reject) => {
                _socket.emit(ev, data, (resp: any) => {
                  if (resp && resp.result === true) resolve(resp.data);
                  else reject(new Error(resp?.message || 'Handshake failed'));
                });
              });
            };
            await clientHandshakeInit(st, rawRequest);
            (appSocket as any)['tpState'] = st;
            console.debug('[Socket] TailProto handshake done', { kv: st.kv, authKeyId: st.authKeyId?.slice(0, 8) });
            // 握手完成后，若存在 token 则通过加密通道补充鉴权
            try { await (appSocket as any).reauthWithTokenIfAvailable?.(); } catch {}
          }
        } catch (e) {
          console.warn('[Socket] TailProto handshake failed, fallback to plaintext:', (e as Error)?.message);
          (appSocket as any)['tpEnabled'] = false;
        }
        try { (appSocket as any).markReady?.(); } catch {}
        _appSocket = appSocket; // 保存本模块实例
        // 同步到共享状态，供其他 bundle 复用
        try {
          const s = getSharedSocketState();
          s.appSocket = appSocket;
          s.creating = null;
        } catch {}
        resolve(appSocket);
        _creatingSocketPromise = null;
        try {
          const s = getSharedSocketState();
          if (s.creating) s.creating = null;
        } catch {}
      });
      _socket.once('error', (err: any) => {
        // 不立即拒绝，交给 socket.io 自身的重连机制，等 connect 再 resolve
        console.warn('[Socket] initial error, waiting for reconnect...', err?.message || err);
      });

      if (isDevelopment) {
        _socket.onAny((...args) => {
          console.debug('Receive Notify:', args);
        });
      }
    })().catch((err) => {
      _creatingSocketPromise = null;
      try {
        const s = getSharedSocketState();
        if (s.creating) s.creating = null;
      } catch {}
      reject(err);
    });
  });
  return _creatingSocketPromise;
}

/**
 * 获取或创建全局 Socket（支持游客，无 token）
 */
export async function getOrCreateSocket(token?: string): Promise<AppSocket> {
  const shared = getSharedSocketState();
  // 若已有连接但为“游客”，而本地存在token，则强制重建带鉴权的连接
  try {
    let desiredToken: string | undefined = token;
    if (!(typeof desiredToken === 'string' && desiredToken.length > 0)) {
      try {
        const got = await tokenGetter();
        if (typeof got === 'string' && got.length > 0) desiredToken = got;
      } catch {}
    }

    const current = shared.appSocket || _appSocket;
    if (current && current.connected) {
      const isGuest = !(current as any).hasAuthToken;
      const shouldUpgrade = isGuest && typeof desiredToken === 'string' && desiredToken.length > 0;
      if (!shouldUpgrade) {
        return current;
      }
      // 强制使用token重建连接
      return await createSocket(desiredToken);
    }
  } catch {}

  if (shared.creating) return await shared.creating;
  if (_creatingSocketPromise) return await _creatingSocketPromise;
  // 未登录禁止创建业务 WS
  const tok = typeof token === 'string' && token.length > 0 ? token : await tokenGetter().catch(() => undefined as any);
  if (!(typeof tok === 'string' && tok.length > 0)) {
    throw new Error('Auth required for WebSocket');
  }
  return await createSocket(tok);
}
  // 🔥 修复：如果提供了token但当前连接是游客，不能复用  // 🔥 关键修复：检查现有连接是否为游客模式、   // 🔥 新增：如果当前是游客连接但提供了token，也要强制重建、