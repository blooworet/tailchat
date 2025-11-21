import { Kafka, logLevel } from 'kafkajs';
import { config } from 'tailchat-server-sdk';
import { getBusStats } from './kafka.producer';

export async function checkBusHealth(): Promise<any> {
  const brokersRaw = (config as any).feature?.kafkaBrokers as string;
  const brokers = String(brokersRaw || '').split(',').map((s) => s.trim()).filter(Boolean);
  const { connected, lastProducedAt } = getBusStats();
  // Optionally compute a quick lag sum for visibility (best-effort)
  let lag: Record<string, number> = {};
  try {
    const kafka = new Kafka({ clientId: 'tailproto-health', brokers, logLevel: logLevel.ERROR });
    const admin = kafka.admin();
    await admin.connect();
    const topics = ['tailproto.rekey.request', 'tailproto.session.update'];
    const groupId = 'tailproto-rekey-session-consumer';
    for (const topic of topics) {
      try {
        const highs = await admin.fetchTopicOffsets(topic);
        const committed = await admin.fetchOffsets({ groupId, topic });
        const committedMap = new Map(committed.map((c: any) => [Number(c.partition), Number(c.offset)]));
        let sum = 0;
        for (const p of highs) {
          const part = Number((p as any).partition);
          const high = Number((p as any).offset);
          const comm = Number(committedMap.get(part) ?? 0);
          sum += Math.max(0, high - comm);
        }
        lag[topic] = sum;
      } catch {}
    }
    try { await admin.disconnect(); } catch {}
  } catch {}
  return {
    brokers: brokers.length,
    connected,
    lastProducedAt,
    consumerLag: lag,
    ts: Date.now(),
  };
}


