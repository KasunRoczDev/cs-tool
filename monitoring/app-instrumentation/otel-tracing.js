'use strict';
// OpenTelemetry distributed tracing — the missing third pillar.
// You have metrics (p95/p99 latency) but can't see WHERE the time goes across
// API → queue → DB. Tracing stitches one request into a single timeline.
//
// Use in any Node/NestJS service (OMS, courier, IoT ingest, or this backend):
//   1. npm i @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node \
//          @opentelemetry/exporter-trace-otlp-http
//   2. node -r ./monitoring/app-instrumentation/otel-tracing.js dist/main.js
//      (the -r preload ensures tracing starts before anything else loads)
//
// Point OTEL_EXPORTER_OTLP_ENDPOINT at a collector (Tempo/Jaeger/Grafana).

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]:
      process.env.OTEL_SERVICE_NAME || 'monitor-backend',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
      process.env.NODE_ENV || 'development',
  }),
  traceExporter: new OTLPTraceExporter({
    // e.g. http://otel-collector:4318/v1/traces
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Auto-traces http, express/nest, pg, ioredis, and more — including
      // BullMQ jobs through ioredis spans.
      '@opentelemetry/instrumentation-fs': { enabled: false }, // too noisy
    }),
  ],
});

sdk.start();
process.on('SIGTERM', () => sdk.shutdown().finally(() => process.exit(0)));

module.exports = sdk;
