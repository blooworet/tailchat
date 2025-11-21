// @ts-nocheck
// 添加ts-nocheck指令来暂时忽略TypeScript的类型检查
import { io, Socket } from 'socket.io-client';
import msgpackParser from 'socket.io-msgpack-parser';
import _isNil from 'lodash/isNil';
import type { InboxItem } from '../../types';
import { showNotification } from '../notifications';

let _socket: any;
let _tp: any = null; // { authKey: CryptoKey, kv: number, seq: number }
/**
 * 创建Socket连接
 * 如果已经有Socket连接则关闭上一个
 * @param token Token
 */
export function createSocket(url: string, token: string): Promise<any> {
  if (!_isNil(_socket)) {
    _socket.close();
  }

  return new Promise((resolve, reject) => {
    _socket = io(url, {
      transports: ['websocket'],
      auth: {
        token,
      },
      forceNew: true,
      parser: msgpackParser,
    });
    _socket.once('connect', async () => {
      // 连接成功
      try {
        if (typeof crypto !== 'undefined' && (crypto as any).subtle) {
          const ecdh = await (crypto as any).subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits', 'deriveKey']);
          const raw = await (crypto as any).subtle.exportKey('raw', ecdh.publicKey);
          const view = new Uint8Array(raw as ArrayBuffer);
          let s = ''; for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
          const clientPubKey = btoa(s);
          const initRes: any = await new Promise((res) => _socket.emit('crypt.init', { clientPubKey }, res));
          if (initRes && initRes.result === true) {
            const d = initRes.data || {};
            const serverRaw = Uint8Array.from(atob(String(d.serverPubKey || '')), (c) => c.charCodeAt(0));
            const serverPub = await (crypto as any).subtle.importKey('raw', serverRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
            const secret = await (crypto as any).subtle.deriveBits({ name: 'ECDH', public: serverPub }, ecdh.privateKey, 256);
            const hkdfKey = await (crypto as any).subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
            const authKey = await (crypto as any).subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('tailproto-authkey') }, hkdfKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
            _tp = { authKey, kv: Number(d.kv) || 1, seq: 0 };
          }
        }
      } catch {}
      resolve(_socket);
    });
    _socket.once('error', () => {
      reject();
    });
  });
}

export function bindSocketEvent(socket: any): void {
  // Strict notify channel: server emits 'notify' + envelope; decrypt and dispatch
  socket.on('notify', async (env: any) => {
    try {
      if (_tp && env && env.v === 2) {
        const iv = Uint8Array.from(atob(env.iv), (c) => c.charCodeAt(0));
        const data = Uint8Array.from(atob(env.d), (c) => c.charCodeAt(0));
        const pt = await (crypto as any).subtle.decrypt({ name: 'AES-GCM', iv }, _tp.authKey, data);
        const text = new TextDecoder().decode(pt);
        try {
          const plain = JSON.parse(text);
          const ev = String(plain?.ev || '');
          const inner = plain?.data;
          if (ev === 'notify:chat.inbox.append' && inner) {
            const inboxItem = inner;
            if (inboxItem.type === 'message') {
              const payload = inboxItem.message ?? inboxItem.payload;
              showNotification({
                title: payload.converseId ?? '',
                body: payload.messageSnippet ?? (payload.plainContent || '消息'),
              });
            }
          }
        } catch {}
      }
    } catch {}
  });
}