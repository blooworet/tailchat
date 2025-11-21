// @ts-nocheck
import { parentPort } from 'worker_threads';
import crypto from 'crypto';

parentPort?.on('message', (msg: any) => {
  try {
    const { op, keyB64, ivB64, dataB64 } = msg || {};
    const key = Buffer.from(String(keyB64 || ''), 'base64');
    const iv = Buffer.from(String(ivB64 || ''), 'base64');
    if (op === 'enc') {
      const pt = Buffer.from(String(dataB64 || ''), 'base64');
      const cipher = (crypto as any).createCipheriv('aes-256-gcm', key as any, iv as any);
      const enc = Buffer.concat([cipher.update(pt as any), cipher.final()] as any);
      const tag = cipher.getAuthTag();
      const out = Buffer.concat([enc, tag]).toString('base64');
      parentPort?.postMessage({ ok: true, d: out });
      return;
    }
    if (op === 'dec') {
      const all = Buffer.from(String(dataB64 || ''), 'base64');
      const tag = all.subarray(all.length - 16);
      const ct = all.subarray(0, all.length - 16);
      const decipher = (crypto as any).createDecipheriv('aes-256-gcm', key as any, iv as any);
      decipher.setAuthTag(tag as any);
      const pt = Buffer.concat([decipher.update(ct as any), decipher.final()] as any).toString('base64');
      parentPort?.postMessage({ ok: true, p: pt });
      return;
    }
    parentPort?.postMessage({ ok: false, message: 'Invalid op' });
  } catch (e) {
    parentPort?.postMessage({ ok: false, message: (e as Error)?.message || 'error' });
  }
});


