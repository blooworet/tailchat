export interface ChannelKeyPair {
  rawKey: ArrayBuffer; // 32 bytes
}

export async function generateChannelKey(): Promise<ChannelKeyPair> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return { rawKey: raw.buffer };
}

async function importAesKey(rawKey: ArrayBuffer): Promise<CryptoKey> {
  return await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptForChannel(rawKey: ArrayBuffer, data: unknown): Promise<{ iv: string; d: string }> {
  const key = await importAesKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(typeof data === 'string' ? data : JSON.stringify(data));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt);
  const ivB64 = btoa(String.fromCharCode(...iv));
  const dB64 = btoa(String.fromCharCode(...new Uint8Array(ct)));
  return { iv: ivB64, d: dB64 };
}

export async function decryptFromChannel(rawKey: ArrayBuffer, payload: { iv: string; d: string }): Promise<any> {
  const key = await importAesKey(rawKey);
  const iv = Uint8Array.from(atob(payload.iv), (c) => c.charCodeAt(0));
  const data = Uint8Array.from(atob(payload.d), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  const text = new TextDecoder().decode(pt);
  try { return JSON.parse(text); } catch { return text; }
}


