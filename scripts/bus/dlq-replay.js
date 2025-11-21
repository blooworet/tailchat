#!/usr/bin/env node
const { Kafka, logLevel } = require('kafkajs');

async function main() {
  const brokers = (process.env.KAFKA_BROKERS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (brokers.length === 0) {
    console.error('KAFKA_BROKERS is required');
    process.exit(1);
  }
  const kafka = new Kafka({ clientId: 'tailproto-dlq-replay', brokers, logLevel: logLevel.ERROR });
  const consumer = kafka.consumer({ groupId: 'tailproto-dlq-replay' });
  const producer = kafka.producer({ allowAutoTopicCreation: false });
  await consumer.connect();
  await producer.connect();
  await consumer.subscribe({ topic: 'tailproto.dlq', fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const raw = message.value ? message.value.toString() : '';
        const obj = JSON.parse(raw || '{}');
        const topic = obj.topic;
        const payloadRaw = obj.raw;
        if (!topic || !payloadRaw) return;
        await producer.send({ topic, messages: [{ key: String(message.key || ''), value: payloadRaw }] });
        console.log('Replayed to', topic);
      } catch (e) {
        console.error('Replay failed', String(e));
      }
    }
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
