import { config } from 'tailchat-server-sdk';
import { Kafka, logLevel } from 'kafkajs';
import { signPayload } from './security';
import fs from 'fs';
import path from 'path';

let registryPromise: Promise<any> | null = null;
const schemaIdCache = new Map<string, number>();

async function getRegistry(): Promise<any | null> {
  try {
    const url = (config as any).feature?.schemaRegistryUrl as string;
    if (!url) return null;
    if (!registryPromise) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { SchemaRegistry } = require('@kafkajs/confluent-schema-registry');
      const reg = new SchemaRegistry({ host: url });
      registryPromise = Promise.resolve(reg);
    }
    return await registryPromise;
  } catch {
    return null;
  }
}

function readTopicSchema(topic: string): any | null {
  try {
    let file = '';
    if (topic === 'tailproto.session.update') file = 'schemas/session.update.avsc';
    else if (topic === 'tailproto.rekey.request') file = 'schemas/rekey.request.avsc';
    else if (topic === 'tailproto.key.rotated') file = 'schemas/key.rotated.avsc';
    else if (topic === 'tailproto.audit') file = 'schemas/audit.avsc';
    if (!file) return null;
    const p = path.resolve(__dirname, file);
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch { return null; }
}

let producerPromise: Promise<any> | null = null;
let _connected = false;
let _lastProducedAt = 0;

async function getProducer(): Promise<any | null> {
  try {
    const enabled = Boolean((config as any).feature?.crossRegionEnabled);
    const brokersRaw = (config as any).feature?.kafkaBrokers as string;
    const brokers = (brokersRaw || '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    if (!enabled || brokers.length === 0) return null;
    if (!producerPromise) {
      const kafka = new Kafka({ clientId: 'tailproto-server', brokers, logLevel: logLevel.ERROR });
      // Strongly require topics to exist
      const admin = kafka.admin();
      await admin.connect();
      try {
        const required = ['tailproto.rekey.request', 'tailproto.session.update', 'tailproto.dlq'];
        const existing = await admin.listTopics();
        const missing = required.filter((t) => !existing.includes(t));
        if (missing.length > 0) {
          throw new Error(`[CrossRegion] Topic missing: ${missing.join(', ')}. Please run deploy/kafka/create-topics.sh before start.`);
        }
      } finally {
        try { await admin.disconnect(); } catch {}
      }
      const transactionalId = String((config as any).feature?.crossRegionTxId || '').trim() || undefined;
      const p = kafka.producer({ allowAutoTopicCreation: false, idempotent: true, transactionalId });
      producerPromise = p.connect().then(() => { _connected = true; return p; });
    }
    return await producerPromise;
  } catch {
    return null;
  }
}

export async function sendEvent(topic: string, key: string, value: unknown): Promise<void> {
  try {
    const p = await getProducer();
    if (!p) return;
    const payloadObj = (value ?? null);
    const payload = payloadObj;
    const reg = await getRegistry();
    let encoded: any = null;
    if (reg) {
      try {
        const subject = `${topic}-value`;
        let id = schemaIdCache.get(subject);
        if (!id) {
          const schema = readTopicSchema(topic);
          const res = await reg.register({ type: 'AVRO', schema: JSON.stringify(schema) }, { subject });
          id = res?.id;
          if (typeof id === 'number') schemaIdCache.set(subject, id);
        }
        if (typeof id === 'number') {
          encoded = await reg.encode(id, { ...(payload as any), token: signPayload(payload) });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[Bus] registry encode failed, fallback JSON', String(e));
      }
    }
    const transactionalId = String((config as any).feature?.crossRegionTxId || '').trim();
    if (transactionalId) {
      try {
        const tx = await p.transaction();
        try {
          await tx.send({ topic, messages: [{ key, value: encoded ?? JSON.stringify({ ...(payload as any), token: signPayload(payload) }) }], acks: -1 });
          await tx.commit();
        } catch (e) {
          try { await tx.abort(); } catch {}
          throw e;
        }
      } catch (e) {
        throw e;
      }
    } else {
      await p.send({
        topic,
        messages: [
          {
            key,
            value: encoded ?? JSON.stringify({ ...(payload as any), token: signPayload(payload) }),
          },
        ],
        acks: -1,
      });
    }
    _lastProducedAt = Date.now();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Bus] sendEvent failed', topic, String(e));
  }
}

export async function stopProducer(): Promise<void> {
  try {
    const p = await producerPromise;
    if (p) await p.disconnect();
  } catch {}
  producerPromise = null;
}

export function getBusStats(): { connected: boolean; lastProducedAt: number } {
  return { connected: _connected, lastProducedAt: _lastProducedAt };
}


