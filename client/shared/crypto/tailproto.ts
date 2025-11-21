export type TailProtoEnvelope = {
  v: 2;
  k: string; // authKeyId
  s: number; // seq
  kv: number; // key version
  iv: string; // base64
  d: string; // base64
  m?: string; // msg_id (request)
  a?: string; // ack msg_id (response)
};

export interface ClientSessionState {
  clientECDH?: CryptoKeyPair;
  serverPubKey?: CryptoKey;
  authKey?: CryptoKey;
  authKeyId?: string;
  kv?: number;
  seq: number;
  resumeToken?: string;
}

async function importServerPublicKeyRaw(base64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
}

async function exportClientPublicKeyRaw(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  const b = new Uint8Array(raw as ArrayBuffer);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

async function deriveAuthKey(clientPriv: CryptoKey, serverPub: CryptoKey): Promise<CryptoKey> {
  const secret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: serverPub },
    clientPriv,
    256
  );
  // HKDF-SHA256 derive 32-byte key
  const hkdfKey = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('tailproto-authkey') },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

async function computeAuthKeyId(authKey: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', authKey);
  const hash = await crypto.subtle.digest('SHA-256', raw);
  const b = new Uint8Array(hash as ArrayBuffer).slice(0, 16);
  let s = '';
  for (let i = 0; i < b.length; i++) s += ('0' + b[i].toString(16)).slice(-2);
  return s;
}

export async function createClientECDH(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits', 'deriveKey']
  ) as CryptoKeyPair;
}

export async function clientHandshakeInit(state: ClientSessionState, request: (event: string, data: any) => Promise<any>): Promise<ClientSessionState> {
  const ecdh = await createClientECDH();
  const clientPubB64 = await exportClientPublicKeyRaw(ecdh.publicKey);
  const res = await request('crypt.init', { clientPubKey: clientPubB64 });
  const serverPub = await importServerPublicKeyRaw(String(res.serverPubKey));
  const authKey = await deriveAuthKey(ecdh.privateKey, serverPub);
  const authKeyId = await computeAuthKeyId(authKey);
  state.clientECDH = ecdh;
  state.serverPubKey = serverPub;
  state.authKey = authKey;
  state.authKeyId = authKeyId;
  state.kv = Number(res.kv) || 1;
  // 可用于计算时钟偏移
  (state as any).serverTime = typeof res.serverTime === 'number' ? res.serverTime : Date.now();
  if (typeof res.resumeToken === 'string') state.resumeToken = res.resumeToken;
  state.seq = 0;
  return state;
}

export async function encryptEnvelope(state: ClientSessionState, payload: any): Promise<TailProtoEnvelope> {
  if (!state.authKey || !state.authKeyId || !state.kv) throw new Error('Session not ready');
  state.seq += 1;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(payload));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, state.authKey, pt);
  const ivB64 = btoa(String.fromCharCode(...iv));
  const data = new Uint8Array(ct);
  const dB64 = btoa(String.fromCharCode(...data));
  const now = Date.now();
  const msgId = `${now}-${state.seq}`;
  return { v: 2, k: state.authKeyId, s: state.seq, kv: state.kv, iv: ivB64, d: dB64, m: msgId };
}

export async function decryptEnvelope(state: ClientSessionState, env: TailProtoEnvelope): Promise<any> {
  if (!state.authKey) throw new Error('Session not ready');
  const iv = Uint8Array.from(atob(env.iv), c => c.charCodeAt(0));
  const data = Uint8Array.from(atob(env.d), c => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, state.authKey, data);
  const text = new TextDecoder().decode(pt);
  try { return JSON.parse(text); } catch { return text; }
}


