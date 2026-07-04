import type { MessagingPort, OutboundMessage } from '@marketplace/core';

// Deliberate stub per spec: TELEGRAM is a declared channel with no delivery
// yet. Failing loudly keeps outbox rows visible as FAILED/DEAD instead of
// silently dropping messages.
export class TelegramAdapter implements MessagingPort {
  async send(message: OutboundMessage): Promise<{ providerMessageId: string }> {
    throw new Error(`TelegramAdapter not implemented (recipient ${message.recipient})`);
  }
}
