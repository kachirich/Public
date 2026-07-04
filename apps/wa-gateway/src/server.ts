import Fastify, { type FastifyInstance } from 'fastify';
import type { FetchLike, OpenWaClient } from './openwa.js';

export interface ServerDeps {
  openwa: OpenWaClient;
  orchestratorBaseUrl: string;
  sharedSecret: string;
  fetchFn?: FetchLike;
}

interface SendBody {
  recipient: string;
  body: string;
}

// Thin wrapper only: /send passes outbound texts to OpenWA, /webhook/openwa
// forwards inbound messages to the orchestrator. No parsing, no state.
export function buildServer(deps?: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: true });
  const fetchFn = deps?.fetchFn ?? globalThis.fetch;

  app.get('/health', async () => ({ status: 'ok', service: 'wa-gateway' }));

  if (!deps) return app; // bare health-check server (unit tests)

  app.post<{ Body: SendBody }>('/send', async (req, reply) => {
    if (req.headers['x-internal-secret'] !== deps.sharedSecret) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { recipient, body } = req.body;
    if (!recipient || !body) {
      return reply.code(400).send({ error: 'recipient and body are required' });
    }
    const { messageId } = await deps.openwa.sendText(recipient, body);
    return { messageId };
  });

  app.post<{ Body: { name: string; participants: string[] } }>('/rooms', async (req, reply) => {
    if (req.headers['x-internal-secret'] !== deps.sharedSecret) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { name, participants } = req.body;
    if (!name || !Array.isArray(participants)) {
      return reply.code(400).send({ error: 'name and participants are required' });
    }
    const { groupId } = await deps.openwa.createGroup(name, participants);
    return { roomId: groupId };
  });

  app.post<{ Body: { roomId: string; participants: string[] } }>('/rooms/dissolve', async (req, reply) => {
    if (req.headers['x-internal-secret'] !== deps.sharedSecret) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { roomId, participants } = req.body;
    if (!roomId || !Array.isArray(participants)) {
      return reply.code(400).send({ error: 'roomId and participants are required' });
    }
    await deps.openwa.dissolveGroup(roomId, participants);
    return { dissolved: true };
  });

  // OpenWA EASY API webhook: onMessage events. Forward raw essentials; the
  // orchestrator owns dedup (wa_message_id) and parsing.
  app.post('/webhook/openwa', async (req, reply) => {
    const event = req.body as { event?: string; data?: { id?: string; from?: string; body?: string } };
    if (event?.event !== 'onMessage' || !event.data?.id || !event.data?.from) {
      return reply.code(202).send({ ignored: true });
    }
    const res = await fetchFn(`${deps.orchestratorBaseUrl}/internal/wa-inbound`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': deps.sharedSecret,
      },
      body: JSON.stringify({
        waMessageId: event.data.id,
        fromE164: `+${event.data.from.replace(/@c\.us$/, '')}`,
        body: event.data.body ?? '',
      }),
    });
    if (!res.ok) {
      // Let OpenWA retry; the orchestrator's dedup makes retries safe.
      return reply.code(502).send({ error: 'orchestrator rejected the event' });
    }
    return { forwarded: true };
  });

  return app;
}
