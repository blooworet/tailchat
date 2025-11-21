import crypto from 'crypto';
import { config } from 'tailchat-server-sdk';

function key(): Buffer {
  return crypto.createHash('sha256').update(String(config.secret || 'tailchat')).digest();
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

export function signPayload(payload: unknown): string {
  const body = toB64Url(Buffer.from(JSON.stringify(payload)));
  const sig = toB64Url(((crypto as any).createHmac('sha256', key() as any).update(body as any).digest()) as Buffer);
  return `${body}.${sig}`;
}

export function verifyPayload(token: string): any | null {
  try {
    const [body, sig] = String(token || '').split('.');
    const expect = toB64Url(((crypto as any).createHmac('sha256', key() as any).update(body as any).digest()) as Buffer);
    if (expect !== sig) return null;
    return JSON.parse(fromB64Url(body).toString('utf8'));
  } catch {
    return null;
  }
}


