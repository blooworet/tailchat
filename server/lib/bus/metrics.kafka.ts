import { Kafka, logLevel } from 'kafkajs';

type Metrics = { set?: (name: string, labels: any, v: number) => void };

export function startKafkaLagCollector(opts: {
  brokers: string[];
  groupId: string;
  topics: string[];
  intervalMs?: number;
  metrics?: Metrics;
  logger?: any;
}): { stop: () => Promise<void> } | null {
  try {
    const brokers = (opts.brokers || []).filter(Boolean);
    if (brokers.length === 0) return null;
    const kafka = new Kafka({ clientId: 'tailproto-lag', brokers, logLevel: logLevel.ERROR });
    const admin = kafka.admin();
    let timer: any = null;
    let stopped = false;

    const setLag = (topic: string, partition: number, v: number) => {
      try { opts.metrics?.set?.('crossregion_kafka_consumer_lag', { topic, partition: String(partition) }, v); } catch {}
    };

    const run = async () => {
      try {
        await admin.connect();
      } catch (e) {
        opts.logger?.warn?.('[Bus] lag collector connect failed', String(e));
      }
      const tick = async () => {
        if (stopped) return;
        try {
          for (const topic of opts.topics) {
            const highs = await admin.fetchTopicOffsets(topic);
            const committed = await admin.fetchOffsets({ groupId: opts.groupId, topic });
            const committedMap = new Map(committed.map((c: any) => [Number(c.partition), Number(c.offset)]));
            for (const p of highs) {
              const part = Number(p.partition);
              const high = Number((p as any).offset);
              const comm = Number(committedMap.get(part) ?? 0);
              const lag = Math.max(0, high - comm);
              setLag(topic, part, lag);
            }
          }
        } catch (e) {
          opts.logger?.warn?.('[Bus] lag collector error', String(e));
        }
      };
      timer = setInterval(tick, opts.intervalMs ?? 5000);
      await tick();
    };

    run();

    return {
      stop: async () => {
        try { stopped = true; if (timer) clearInterval(timer); } catch {}
        try { await admin.disconnect(); } catch {}
      },
    };
  } catch {
    return null;
  }
}


