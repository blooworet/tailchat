// @ts-nocheck
import crypto from 'crypto';
import { Worker } from 'worker_threads';
import path from 'path';
import { config } from 'tailchat-server-sdk';

export interface ServerKeyPair {
  curve: 'prime256v1';
  publicKeyBase64: string; // uncompressed
  privateKey: crypto.ECDH;
}

export function generateServerKeyPair(): ServerKeyPair {
  const ecdh = crypto.createECDH('prime256v1');
  const publicKeyBase64 = ecdh.generateKeys('base64', 'uncompressed');
  return { curve: 'prime256v1', publicKeyBase64, privateKey: ecdh };
}

export function deriveAuthKey(
  serverPriv: crypto.ECDH,
  clientPublicKeyBase64: string
): Buffer {
  const clientPub = Buffer.from(clientPublicKeyBase64, 'base64');
  const secret = (serverPriv as any).computeSecret(clientPub as any);
  // Derive a 32-byte key via HKDF-SHA256
  const salt = Buffer.alloc(0);
  const info = Buffer.from('tailproto-authkey');
  return hkdfSha256(secret, salt, info, 32);
}

export function computeAuthKeyId(authKey: Buffer): string {
  // Use first 16 bytes of SHA256 as key id (hex)
  const h = (crypto as any).createHash('sha256').update(authKey as any).digest();
  return h.subarray(0, 16).toString('hex');
}

export function aesGcmEncrypt(
  key: Buffer,
  plaintext: Buffer,
  iv: Buffer
): { ciphertextBase64: string } {
  const cipher: any = (crypto as any).createCipheriv('aes-256-gcm', key as any, iv as any);
  const enc = Buffer.concat([cipher.update(plaintext as any), cipher.final()] as any);
  const tag: any = cipher.getAuthTag();
  const out = Buffer.concat([enc, tag]);
  return { ciphertextBase64: out.toString('base64') };
}

export function aesGcmDecrypt(
  key: Buffer,
  ciphertextBase64: string,
  iv: Buffer
): Buffer {
  const data = Buffer.from(ciphertextBase64, 'base64');
  if (data.length < 16) throw new Error('Invalid GCM payload');
  const tag = data.subarray(data.length - 16);
  const ct = data.subarray(0, data.length - 16);
  const decipher: any = (crypto as any).createDecipheriv('aes-256-gcm', key as any, iv as any);
  decipher.setAuthTag(tag as any);
  return Buffer.concat([decipher.update(ct as any), decipher.final()] as any);
}

function hkdfSha256(
  ikm: Buffer,
  salt: Buffer,
  info: Buffer,
  length: number
): Buffer {
  const prk = (crypto as any).createHmac('sha256', salt as any).update(ikm as any).digest();
  let t = Buffer.alloc(0);
  const okm: Buffer[] = [];
  let i = 0;
  while (Buffer.concat(okm).length < length) {
    i += 1;
    const h = (crypto as any)
      .createHmac('sha256', prk as any)
      .update((Buffer as any).concat([t, info, Buffer.from([i])]) as any)
      .digest();
    okm.push(h);
    t = h;
  }
  return Buffer.concat(okm).subarray(0, length);
}

export function randomIv(): Buffer {
  return crypto.randomBytes(12);
}

function shouldUseWorker(payloadLength: number): boolean {
  try {
    const backend = (config as any).feature?.tailprotoCryptoBackend || process.env.TAILPROTO_CRYPTO_BACKEND || 'node';
    const threshold = (config as any).feature?.tailprotoCryptoBatchThreshold || Number(process.env.TAILPROTO_CRYPTO_BATCH_THRESHOLD || '2048');
    return backend === 'worker' && payloadLength >= threshold;
  } catch {
    return false;
  }
}

export async function encryptPayload(key: Buffer, plaintext: Buffer, iv: Buffer): Promise<{ ciphertextBase64: string }> {
  if (shouldUseWorker(plaintext.length)) {
    try {
      const worker = new Worker(path.resolve(__dirname, './crypto.worker.ts'));
      return await new Promise((resolve, reject) => {
        worker.once('message', (m: any) => {
          try { worker.terminate(); } catch {}
          if (m && m.ok) resolve({ ciphertextBase64: m.d });
          else reject(new Error(String(m?.message || 'worker enc error')));
        });
        worker.once('error', (e) => {
          try { worker.terminate(); } catch {}
          reject(e);
        });
        worker.postMessage({ op: 'enc', keyB64: key.toString('base64'), ivB64: iv.toString('base64'), dataB64: plaintext.toString('base64') });
      });
    } catch {}
  }
  return aesGcmEncrypt(key, plaintext, iv);
}

export async function decryptPayload(key: Buffer, ciphertextBase64: string, iv: Buffer): Promise<Buffer> {
  const dataLen = Buffer.from(ciphertextBase64, 'base64').length;
  if (shouldUseWorker(dataLen)) {
    try {
      const worker = new Worker(path.resolve(__dirname, './crypto.worker.ts'));
      return await new Promise((resolve, reject) => {
        worker.once('message', (m: any) => {
          try { worker.terminate(); } catch {}
          if (m && m.ok) resolve(Buffer.from(String(m.p || ''), 'base64'));
          else reject(new Error(String(m?.message || 'worker dec error')));
        });
        worker.once('error', (e) => {
          try { worker.terminate(); } catch {}
          reject(e);
        });
        worker.postMessage({ op: 'dec', keyB64: key.toString('base64'), ivB64: iv.toString('base64'), dataB64: ciphertextBase64 });
      });
    } catch {}
  }
  return aesGcmDecrypt(key, ciphertextBase64, iv);
}


