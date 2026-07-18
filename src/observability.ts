import { CallbackHandler } from '@langfuse/langchain';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';

// LangfuseSpanProcessor reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL.
// Map the legacy LANGFUSE_HOST env var so both names work.
if (process.env.LANGFUSE_HOST && !process.env.LANGFUSE_BASE_URL) {
  process.env.LANGFUSE_BASE_URL = process.env.LANGFUSE_HOST;
}

function isConfigured(): boolean {
  return !!(process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_PUBLIC_KEY);
}

const spanProcessor = isConfigured() ? new LangfuseSpanProcessor() : null;

const sdk = new NodeSDK({
  spanProcessors: spanProcessor ? [spanProcessor] : [],
});
sdk.start();

export const langfuse: CallbackHandler | null = isConfigured() ? new CallbackHandler() : null;

export async function shutdown(): Promise<void> {
  await sdk.shutdown();
}

export function traceOptions(
  sessionId: string | undefined,
  metadata: Record<string, unknown>,
): {
  callbacks: CallbackHandler[];
  metadata: Record<string, unknown>;
} {
  return {
    callbacks: langfuse ? [langfuse] : [],
    metadata: {
      ...metadata,
      ...(sessionId ? { langfuseSessionId: sessionId } : {}),
    },
  };
}
