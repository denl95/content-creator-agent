import { CallbackHandler } from 'langfuse-langchain';

// Singleton — one handler per process, shared across all nodes.
// Returns null if Langfuse env vars are not set so callers can skip callbacks safely.
function createHandler(): CallbackHandler | null {
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;

  if (!secretKey || !publicKey) return null;

  return new CallbackHandler({
    secretKey,
    publicKey,
    baseUrl: process.env.LANGFUSE_HOST ?? 'https://cloud.langfuse.com',
  });
}

export const langfuse: CallbackHandler | null = createHandler();

// Call at process exit to flush all buffered events before the process terminates.
export async function shutdown(): Promise<void> {
  await langfuse?.shutdownAsync();
}

// Returns a callbacks array ready to spread into any .invoke() options object.
// Pass sessionId (e.g. the LangGraph thread_id) to group all traces from one
// run into a single Langfuse session, enabling the Sessions view in the UI.
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
