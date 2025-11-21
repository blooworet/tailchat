import { generateRawKey } from './e2ee';

const STORAGE_KEY = 'tailchat.e2ee.keys';

type KeyMap = Record<string, string>; // converseId -> base64(rawKey)

function load(): KeyMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as KeyMap) : {};
  } catch {
    return {};
  }
}

function save(map: KeyMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

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

let cache: KeyMap | null = null;

function ensureLoaded(): KeyMap {
  if (!cache) cache = load();
  return cache;
}

export function isE2EEEnabledForConverse(converseId: string): boolean {
  const map = ensureLoaded();
  return typeof map[converseId] === 'string' && map[converseId].length > 0;
}

export async function enableE2EEForConverse(converseId: string): Promise<void> {
  const map = ensureLoaded();
  if (!map[converseId]) {
    const rawKey = await generateRawKey(32);
    map[converseId] = toBase64(rawKey);
    save(map);
  }
}

export function disableE2EEForConverse(converseId: string): void {
  const map = ensureLoaded();
  if (map[converseId]) {
    delete map[converseId];
    save(map);
  }
}

export function getRawKeyForConverse(converseId: string): ArrayBuffer | null {
  const map = ensureLoaded();
  const b64 = map[converseId];
  if (!b64) return null;
  return fromBase64(b64);
}


