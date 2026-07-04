import {
  dispatchOutbox,
  pollTimers,
  PHASE3_HANDLERS,
  type MessagingPort,
  type TemplateRenderer,
  type TimerHandler,
} from '@marketplace/core';
import { Queue, Worker } from 'bullmq';
import type { Pool } from 'pg';

export interface WorkerDeps {
  pool: Pool;
  messaging: MessagingPort;
  render: TemplateRenderer;
  redisUrl: string;
  /** Tick interval in ms. BullMQ's floor for repeatable jobs is 1000. */
  tickMs?: number;
  timerHandlers?: Record<string, TimerHandler>;
}

export interface RunningWorkers {
  close(): Promise<void>;
}

const OUTBOX_QUEUE = 'outbox-dispatch';
const TIMER_QUEUE = 'timer-poll';

// Both loops are stateless ticks over Postgres (SKIP LOCKED does the real
// coordination), so BullMQ only provides the durable heartbeat. Running
// several orchestrator instances is safe.
export async function startWorkers(deps: WorkerDeps): Promise<RunningWorkers> {
  const connection = { url: deps.redisUrl };
  const tickMs = deps.tickMs ?? 5000;
  const handlers = deps.timerHandlers ?? PHASE3_HANDLERS;

  const outboxQueue = new Queue(OUTBOX_QUEUE, { connection });
  const timerQueue = new Queue(TIMER_QUEUE, { connection });

  await outboxQueue.upsertJobScheduler('outbox-tick', { every: tickMs });
  await timerQueue.upsertJobScheduler('timer-tick', { every: tickMs });

  const outboxWorker = new Worker(
    OUTBOX_QUEUE,
    async () => dispatchOutbox(deps.pool, deps.messaging, deps.render),
    { connection },
  );
  const timerWorker = new Worker(TIMER_QUEUE, async () => pollTimers(deps.pool, handlers), { connection });

  return {
    async close() {
      await Promise.all([outboxWorker.close(), timerWorker.close()]);
      await Promise.all([outboxQueue.close(), timerQueue.close()]);
    },
  };
}
