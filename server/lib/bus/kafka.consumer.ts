import { config } from 'tailchat-server-sdk';
import { TailProtoSessionRegistry } from '../tailproto/session-registry';
import { Kafka, logLevel } from 'kafkajs';
import { config } from 'tailchat-server-sdk';
import type { Server as SocketServer } from 'socket.io';
import type Redis from 'ioredis';
import { dedupeHit } from './dedupe.store';
import { verifyPayload } from './security';
import { writeSessionSnapshot } from '../tailproto/session-store.redis';
import fs from 'fs';
import path from 'path';
import { sendEvent as busSend } from './kafka.producer';

let consumerInstance: any | null = null;

function buildUserRoomId(userId: string): string {
  return `u-${userId}`;
}

type Metrics = { inc?: (name: string, labels?: any, v?: number) => void; set?: (name: string, labels: any, v: number) => void };

let natsConn: any | null = null;

async function publishLocalRekey(userId: string, io: SocketServer, logger?: any) {
  try {
    const useNats = String(((config as any).feature?.crossRegionLocalBus || 'redis')).toLowerCase() === 'nats';
    const natsUrl = String((config as any).feature?.natsUrl || '')
      .trim();
    if (useNats && natsUrl) {
      try {
        if (!natsConn) {
          // dynamic require to avoid hard dependency
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { connect } = require('nats');
          natsConn = await connect({ servers: natsUrl });
        }
        await natsConn.publish(`tp.rekey.user.${userId}`, Buffer.from(JSON.stringify({ ts: Date.now() })));
      } catch (e) {
        logger?.warn?.('[Bus] NATS publish failed, falling back to Socket.IO', String(e));
      }
    }
  } catch {}
  try {
    const force = !!((config as any).feature?.tailprotoRekeyForceNotify ?? true);
    const deadlineMs = Number((config as any).feature?.tailprotoRekeyDeadlineMs ?? 30 * 1000);
    const nowTs = Date.now();
    const sockets = await io.in(`u-${userId}`).fetchSockets();
    sockets.forEach((sock) => {
      try {
        const sess = TailProtoSessionRegistry.get(sock.id);
        if (sess) (sess as any).rekeyDeadlineTs = nowTs + deadlineMs;
      } catch {}
      sock.emit('notify:tailproto.rekey.required', { ts: nowTs, src: 'kafka', force, deadlineMs });
    });
  } catch (e) {
    logger?.warn?.('[Bus] rekey.request deliver failed', userId, String(e));
  }
}

let registryPromise: Promise<any> | null = null;

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
  } catch { return null; }
}

export async function startTailProtoConsumers(io: SocketServer, redis: Redis.Redis, logger?: any, metrics?: Metrics): Promise<void> {
  try {
    const enabled = Boolean((config as any).feature?.crossRegionEnabled);
    const brokersRaw = (config as any).feature?.kafkaBrokers as string;
    const brokers = (brokersRaw || '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    if (!enabled || brokers.length === 0) {
      return;
    }
    const kafka = new Kafka({ clientId: 'tailproto-consumer', brokers, logLevel: logLevel.ERROR });
    const consumer = kafka.consumer({ groupId: 'tailproto-rekey-session-consumer' });
    await consumer.connect();
    await consumer.subscribe({ topic: 'tailproto.rekey.request', fromBeginning: false });
    await consumer.subscribe({ topic: 'tailproto.session.update', fromBeginning: false });
    await consumer.subscribe({ topic: 'tailproto.key.rotated', fromBeginning: false });
    await consumer.subscribe({ topic: 'tailproto.audit', fromBeginning: false });
    const reg = await getRegistry();
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const key = message.key ? message.key.toString() : '';
          let obj: any = null;
          if (reg) {
            try { obj = await reg.decode(message.value); } catch {}
          }
          const valStr = obj ? JSON.stringify(obj) : (message.value ? message.value.toString() : '');
          metrics?.inc?.('tailproto_bus_messages_total', { topic }, 1);
          const producedAt = Number(message.timestamp ? String(message.timestamp) : Date.now());
          const lagMs = Date.now() - producedAt;
          if (Number.isFinite(lagMs)) metrics?.set?.('tailproto_bus_apparent_lag_ms', { topic, partition: String(partition) }, lagMs);
          if (Number.isFinite(lagMs)) metrics?.set?.('crossregion_kafka_replication_lag_ms', { topic }, lagMs);
          // verify
          let payload: any = null;
          try {
            const parsed = obj || JSON.parse(valStr || '{}');
            const verified = verifyPayload(parsed?.token || '');
            if (!verified) {
              metrics?.inc?.('tailproto_bus_verify_failures_total', { topic }, 1);
              return;
            }
            payload = verified;
          } catch {
            metrics?.inc?.('tailproto_bus_verify_failures_total', { topic }, 1);
            return;
          }
          if (topic === 'tailproto.rekey.request') {
            const requestId = String(payload?.requestId || '');
            const userId = String(payload?.userId || '');
            if (!userId) return;
            const dup = await dedupeHit(redis, `rekey:${requestId || key}`, 300);
            if (dup) return;
            await publishLocalRekey(userId, io, logger);
            logger?.info?.('[Bus] rekey.request delivered', { userId, requestId, partition });
            metrics?.inc?.('tailproto_bus_rekey_delivered_total', {}, 1);
          } else if (topic === 'tailproto.session.update') {
            try {
              await writeSessionSnapshot(redis, String(payload?.sessionId || key), {
                authKeyId: String(payload?.authKeyId || ''),
                kv: Number(payload?.kv || 0),
                kvTs: Number(payload?.kvTs || 0),
                lastSeq: Number(payload?.lastSeq || 0),
                userId: String(payload?.userId || ''),
              }, 180);
              metrics?.inc?.('tailproto_bus_session_update_total', {}, 1);
            } catch {}
            logger?.info?.('[Bus] session.update received', { key, size: valStr.length, partition });
          } else if (topic === 'tailproto.key.rotated') {
            logger?.info?.('[Bus] key.rotated received', { userId: payload?.userId, kv: payload?.kv });
          } else if (topic === 'tailproto.audit') {
            logger?.info?.('[Bus] audit', payload);
          }
        } catch (e) {
          try {
            const raw = message.value ? message.value.toString() : '';
            await busSend('tailproto.dlq', String(message.key || ''), { topic, raw, error: String(e) });
          } catch {}
          logger?.warn?.('[Bus] consumer error', String(e));
        }
      },
    });
    consumerInstance = consumer;
    logger?.info?.('[Bus] TailProto consumers started');
  } catch (e) {
    logger?.warn?.('[Bus] startTailProtoConsumers failed', String(e));
  }
}

export async function stopTailProtoConsumers(logger?: any): Promise<void> {
  try {
    if (consumerInstance) {
      await consumerInstance.disconnect();
      consumerInstance = null;
      logger?.info?.('[Bus] TailProto consumers stopped');
    }
  } catch (e) {
    logger?.warn?.('[Bus] stopTailProtoConsumers failed', String(e));
  }
}


