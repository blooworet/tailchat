import crypto from 'crypto';
import { config } from 'tailchat-server-sdk';

export interface SessionTokenPayload {
  authKeyCipher: string; // base64(iv + ciphertext + tag)
  kv: number;
  kvTs: number;
  userId?: string;
  issuedAt: number;
  exp: number;
}

function toB64Url(buf: Buffer): string {
  const b = buf.toString('base64');
  return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromB64Url(s: string): Buffer {
  let b = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4 !== 0) b += '=';
  return Buffer.from(b, 'base64');
}

function getKey(): Buffer {
  return crypto.createHash('sha256').update(String(config.secret || 'tailchat')).digest();
}

export function createSessionToken(params: { authKey: Buffer; kv: number; kvTs: number; userId?: string; ttlSec?: number }): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher: any = (crypto as any).createCipheriv('aes-256-gcm', key as any, iv as any);
  const enc = Buffer.concat([cipher.update(params.authKey as any), cipher.final()] as any);
  const tag = cipher.getAuthTag();
  const authKeyCipher = Buffer.concat([iv, enc, tag]).toString('base64');
  const ttl = typeof params.ttlSec === 'number' ? params.ttlSec : 10 * 60;
  const payload: SessionTokenPayload = {
    authKeyCipher,
    kv: params.kv,
    kvTs: params.kvTs,
    userId: params.userId,
    issuedAt: Date.now(),
    exp: Date.now() + ttl * 1000,
  };
  const body = toB64Url(Buffer.from(JSON.stringify(payload)));
  const sig = toB64Url(((crypto as any).createHmac('sha256', key as any).update(body as any).digest()) as Buffer);
  return `${body}.${sig}`;
}

export function verifyAndExtractSessionToken(token: string): { authKey: Buffer; kv: number; kvTs: number; userId?: string } | null {
  try {
    const [body, sig] = String(token || '').split('.');
    const key = getKey();
    const expect = toB64Url(((crypto as any).createHmac('sha256', key as any).update(body as any).digest()) as Buffer);
    if (expect !== sig) return null;
    const raw = fromB64Url(body).toString('utf8');
    const payload = JSON.parse(raw) as SessionTokenPayload;
    if (!(payload && typeof payload.exp === 'number' && payload.exp >= Date.now())) return null;
    const buf = Buffer.from(payload.authKeyCipher, 'base64');
    const iv = buf.subarray(0, 12);
    const data = buf.subarray(12, buf.length - 16);
    const tag = buf.subarray(buf.length - 16);
  const decipher: any = (crypto as any).createDecipheriv('aes-256-gcm', key as any, iv as any);
  decipher.setAuthTag(tag as any);
  const authKey = Buffer.concat([decipher.update(data as any), decipher.final()] as any);
    return { authKey, kv: payload.kv, kvTs: payload.kvTs, userId: payload.userId };
  } catch {
    return null;
  }
}


