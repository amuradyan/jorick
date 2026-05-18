import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

const haveCreds =
  process.env.LANGFUSE_PUBLIC_KEY &&
  process.env.LANGFUSE_SECRET_KEY &&
  process.env.LANGFUSE_BASE_URL;

let sdk = null;

if (haveCreds) {
  if (process.env.OTEL_DEBUG === '1') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }
  sdk = new NodeSDK({
    spanProcessors: [new LangfuseSpanProcessor({ flushAt: 1 })],
  });
  sdk.start();
  console.log(`langfuse: tracing enabled (${process.env.LANGFUSE_BASE_URL})`);

  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, async () => {
      try { await sdk.shutdown(); } catch (e) { console.error('langfuse shutdown:', e?.message || e); }
      process.exit(0);
    });
  }
} else {
  console.log('langfuse: missing LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL — tracing disabled');
}

export { startActiveObservation, startObservation } from '@langfuse/tracing';
