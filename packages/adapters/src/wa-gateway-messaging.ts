import type { MessagingPort, OutboundMessage } from '@marketplace/core';
import { expectOk, type FetchLike } from './http.js';

export interface WaGatewayConfig {
  baseUrl: string;
  sharedSecret: string;
}

// WhatsApp sends go through apps/wa-gateway (the thin OpenWA wrapper), never
// to OpenWA directly from the orchestrator.
export class WaGatewayMessagingAdapter implements MessagingPort {
  constructor(
    private readonly config: WaGatewayConfig,
    private readonly fetchFn: FetchLike = globalThis.fetch,
  ) {}

  async send(message: OutboundMessage): Promise<{ providerMessageId: string }> {
    if (message.channel !== 'WHATSAPP') {
      throw new Error(`WaGatewayMessagingAdapter cannot send channel ${message.channel}`);
    }
    const res = await this.fetchFn(`${this.config.baseUrl}/send`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': this.config.sharedSecret,
      },
      body: JSON.stringify({ recipient: message.recipient, body: message.body }),
    });
    const body = (await expectOk('wa-gateway', res)) as { messageId: string };
    return { providerMessageId: body.messageId };
  }
}
