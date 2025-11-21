import { TailchatBaseClient } from './base';
import io, { Socket } from 'socket.io-client';
import * as msgpackParser from 'socket.io-msgpack-parser';
import type { ChatMessage } from 'tailchat-types';

// Debug helpers
function _preview(obj: any, max: number = 400): string {
  try { const s = JSON.stringify(obj); return s.length > max ? s.slice(0, max) + '…' : s; } catch { const s = String(obj); return s.length > max ? s.slice(0, max) + '…' : s; }
}

export class TailchatWsClient extends TailchatBaseClient {
  public socket: Socket | null = null;
  public enableTailProto: boolean = false;
  private _tpState: any = null;

  constructor(
    public url: string,
    public appSecret: string,
    public disableMsgpack: boolean = true,
    public appId: string = '', // 保留参数以兼容旧版本，但默认为空字符串
    enableTailProto: boolean = false
  ) {
    super(url, appSecret, appId);
    this.enableTailProto = enableTailProto;
  }

  connect(): Promise<Socket> {
    return new Promise<Socket>(async (resolve, reject) => {
      await this.waitingForLogin();

      const token = this.jwt;
      const socket = (this.socket = io(this.url, {
        transports: ['websocket'],
        auth: {
          token,
        },
        forceNew: true,
        parser: this.disableMsgpack ? undefined : msgpackParser,
      }));

      socket.once('connect', async () => {
        // 连接成功
        const cryptoRef: any = (typeof globalThis !== 'undefined' && (globalThis as any).crypto) || undefined;
        if (this.enableTailProto && cryptoRef && cryptoRef.subtle) {
          try {
            const ecdh = await cryptoRef.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits', 'deriveKey']);
            const raw = await cryptoRef.subtle.exportKey('raw', ecdh.publicKey);
            const view = new Uint8Array(raw as ArrayBuffer);
            let s = ''; for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
            const clientPubKey = btoa(s);
            console.log('[SDK][TP] handshake -> crypt.init');
            const initRes: any = await socket.emitWithAck('crypt.init', { clientPubKey });
            if (!(initRes && initRes.result === true)) throw new Error('crypt.init failed');
            const d = initRes.data || {};
            const serverRaw = Uint8Array.from(atob(String(d.serverPubKey || '')), (c) => c.charCodeAt(0));
            const serverPub = await cryptoRef.subtle.importKey('raw', serverRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
            const secret = await cryptoRef.subtle.deriveBits({ name: 'ECDH', public: serverPub }, ecdh.privateKey, 256);
            const hkdfKey = await cryptoRef.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
            const authKey = await cryptoRef.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('tailproto-authkey') }, hkdfKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
            this._tpState = { authKey, kv: Number(d.kv) || 1, seq: 0 };
            console.log('[SDK][TP] handshake ok', { kv: this._tpState.kv });
          } catch (e) {
            console.warn('[SDK] TailProto handshake failed, fallback to plaintext', (e as Error)?.message);
            this._tpState = null;
          }
        }
        this.emit('chat.converse.findAndJoinRoom')
          .then((res: any) => {
            console.log('Joined rooms', res.data);
            resolve(socket);
          })
          .catch((err: any) => {
            reject(err);
          });
      });
      socket.once('error', () => {
        reject();
      });

      socket.on('disconnect', (reason) => {
        console.log(`disconnect due to ${reason}`);
        this.socket = null;
      });

      socket.onAny((ev) => {
        console.log('onAny', ev);
      });
    });
  }

  disconnect() {
    if (!this.socket) {
      console.warn('You should call it after connect');
      return;
    }

    this.socket.disconnect();
    this.socket = null;
  }

  emit(eventName: string, eventData: any = {}) {
    if (!this.socket) {
      console.warn('Socket未初始化，请先调用connect方法');
      return Promise.reject('Socket未初始化');
    }
    const st = this._tpState;
    const doEmit = async () => {
      if (st && eventName !== 'crypt.init' && eventName !== 'crypt.resume') {
        try {
          st.seq += 1;
          const cryptoRef: any = (typeof globalThis !== 'undefined' && (globalThis as any).crypto) || undefined;
          if (!cryptoRef || !cryptoRef.subtle) throw new Error('WebCrypto unavailable');
          const iv = cryptoRef.getRandomValues(new Uint8Array(12));
          // Strict: inner { ev, data }
          const inner = { ev: eventName, data: eventData };
          console.log('[SDK][TP][req] encrypt <-', eventName, _preview(eventData));
          const pt = new TextEncoder().encode(JSON.stringify(inner));
          const ct = await cryptoRef.subtle.encrypt({ name: 'AES-GCM', iv }, st.authKey, pt);
          const ivB64 = btoa(String.fromCharCode(...iv));
          const data = new Uint8Array(ct);
          const dB64 = btoa(String.fromCharCode(...data));
          const env = { v: 2, k: 'k', s: st.seq, kv: st.kv, iv: ivB64, d: dB64 };
          const sock = this.socket as Socket;
          // Outer event is fixed to 'tp.invoke'
          console.log('[SDK][TP][req] emit tp.invoke env', _preview({ kv: env.kv, s: env.s }));
          return await sock.emitWithAck('tp.invoke', env).then(async (resp: any) => {
            if (resp && resp.result === true && resp.data && resp.data.v === 2) {
              console.log('[SDK][TP][ack] decrypting env');
              const iv2 = Uint8Array.from(atob(resp.data.iv), (c) => c.charCodeAt(0));
              const d2 = Uint8Array.from(atob(resp.data.d), (c) => c.charCodeAt(0));
              const pt2 = await cryptoRef.subtle.decrypt({ name: 'AES-GCM', iv: iv2 }, st.authKey, d2);
              const text = new TextDecoder().decode(pt2);
              try { resp.data = JSON.parse(text); } catch { resp.data = text; }
              console.log('[SDK][TP][ack] decrypt ok ->', _preview(resp.data));
            }
            return resp;
          });
        } catch (e) {
          console.warn('[SDK] TailProto encrypt failed, fallback', (e as Error)?.message);
        }
      }
      const sock = this.socket as Socket;
      return await sock.emitWithAck(eventName, eventData);
    };
    return doEmit();
  }

  on(eventName: string, callback: (payload: any) => void) {
    if (!this.socket) {
      console.warn('You should call it after connect');
      return;
    }

    const st = this._tpState;
    if (st) {
      // Strict notify routing: listen 'notify' and dispatch to notify:* subscribers
      if (eventName.startsWith('notify:')) {
        this.socket.on('notify', async (payload: any) => {
          try {
            if (payload && payload.v === 2) {
              console.log('[SDK][TP][notify] recv env');
              const iv2 = Uint8Array.from(atob(payload.iv), (c) => c.charCodeAt(0));
              const d2 = Uint8Array.from(atob(payload.d), (c) => c.charCodeAt(0));
              const cryptoRef: any = (typeof globalThis !== 'undefined' && (globalThis as any).crypto) || undefined;
              if (!cryptoRef || !cryptoRef.subtle) throw new Error('WebCrypto unavailable');
              const pt2 = await cryptoRef.subtle.decrypt({ name: 'AES-GCM', iv: iv2 }, st.authKey, d2);
              const text = new TextDecoder().decode(pt2);
              try {
                const plain = JSON.parse(text);
                console.log('[SDK][TP][notify] decrypt ok ->', plain?.ev);
                if (plain && plain.ev === eventName) {
                  callback(plain.data);
                }
              } catch {}
            }
          } catch {}
        });
        return;
      }
      // Default: keep existing behavior
      this.socket.on(eventName, async (payload: any) => {
        try {
          if (payload && payload.v === 2) {
            const iv2 = Uint8Array.from(atob(payload.iv), (c) => c.charCodeAt(0));
            const d2 = Uint8Array.from(atob(payload.d), (c) => c.charCodeAt(0));
            const cryptoRef: any = (typeof globalThis !== 'undefined' && (globalThis as any).crypto) || undefined;
            if (!cryptoRef || !cryptoRef.subtle) throw new Error('WebCrypto unavailable');
            const pt2 = await cryptoRef.subtle.decrypt({ name: 'AES-GCM', iv: iv2 }, st.authKey, d2);
            const text = new TextDecoder().decode(pt2);
            try { payload = JSON.parse(text); } catch {}
          }
        } catch {}
        callback(payload);
      });
      return;
    }
    this.socket.on(eventName, callback);
  }

  once(eventName: string, callback: (payload: any) => void) {
    if (!this.socket) {
      console.warn('You should call it after connect');
      return;
    }

    this.socket.once(eventName, callback);
  }

  off(eventName: string, callback: (payload: any) => void) {
    if (!this.socket) {
      console.warn('You should call it after connect');
      return;
    }

    this.socket.off(eventName, callback);
  }

  onMessage(callback: (messagePayload: ChatMessage) => void) {
    this.on('notify:chat.message.add', callback);
  }

  onMessageUpdate(callback: (messagePayload: ChatMessage) => void) {
    this.on('notify:chat.message.update', callback);
  }

  // Edit message via WS
  editMessage(payload: { messageId: string; content?: string; meta?: any }) {
    return this.emit('chat.message.editMessage', payload);
  }
}