#!/usr/bin/env bash
set -euo pipefail

BROKERS="${KAFKA_BROKERS:-localhost:9092}"

kafka-topics --bootstrap-server "$BROKERS" --create \
  --topic tailproto.rekey.request \
  --partitions 12 \
  --replication-factor 3 \
  --config retention.ms=$((7*24*3600*1000)) || true

kafka-topics --bootstrap-server "$BROKERS" --create \
  --topic tailproto.session.update \
  --partitions 12 \
  --replication-factor 3 \
  --config cleanup.policy=compact || true

kafka-topics --bootstrap-server "$BROKERS" --describe --topic tailproto.rekey.request || true
kafka-topics --bootstrap-server "$BROKERS" --describe --topic tailproto.session.update || true

kafka-topics --bootstrap-server "$BROKERS" --create \
  --topic tailproto.dlq \
  --partitions 6 \
  --replication-factor 3 \
  --config retention.ms=$((7*24*3600*1000)) || true

kafka-topics --bootstrap-server "$BROKERS" --create \
  --topic tailproto.key.rotated \
  --partitions 12 \
  --replication-factor 3 \
  --config retention.ms=$((30*24*3600*1000)) || true

kafka-topics --bootstrap-server "$BROKERS" --create \
  --topic tailproto.audit \
  --partitions 12 \
  --replication-factor 3 \
  --config retention.ms=$((30*24*3600*1000)) || true
