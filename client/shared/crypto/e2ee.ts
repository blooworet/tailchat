import type { E2EEContentString } from '../types/e2ee';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

const PREFIX = 'E2EE.v1';

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function generateRawKey(bytes = 32): Promise<ArrayBuffer> {
  const key = crypto.getRandomValues(new Uint8Array(bytes));
  return key.buffer;
}

async function importAesGcmKey(rawKey: ArrayBuffer): Promise<CryptoKey> {
  return await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptStringWithRawKey(
  rawKey: ArrayBuffer,
  plaintext: string
): Promise<E2EEContentString> {
  const key = await importAesGcmKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = TEXT_ENCODER.encode(plaintext);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt);
  const ivB64 = toBase64(iv.buffer);
  const ctB64 = toBase64(ct);
  return `${PREFIX}:${ivB64}:${ctB64}`;
}

export async function decryptStringWithRawKey(
  rawKey: ArrayBuffer,
  content: E2EEContentString
): Promise<string> {
  if (!content || !content.startsWith(PREFIX + ':')) {
    // 非加密内容，原样返回
    return content;
  }
  const parts = content.split(':');
  if (parts.length !== 3) throw new Error('Invalid E2EE content format');
  const iv = new Uint8Array(fromBase64(parts[1]));
  const ct = fromBase64(parts[2]);
  const key = await importAesGcmKey(rawKey);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return TEXT_DECODER.decode(pt);
}

export function isE2EEContentString(str: string | undefined | null): boolean {
  return typeof str === 'string' && str.startsWith(PREFIX + ':');
}


