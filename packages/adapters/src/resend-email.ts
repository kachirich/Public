import type { MessagingPort, OutboundMessage } from '@marketplace/core';
import { expectOk, type FetchLike } from './http.js';

export interface ResendConfig {
  apiKey: string;
  from: string;
  baseUrl?: string;
}

// Resend email adapter. EMAIL channel only — the channel router decides
// what goes where; this adapter refuses anything else loudly.
export class EmailAdapter implements MessagingPort {
  private readonly baseUrl: string;

  constructor(
    private readonly config: ResendConfig,
    private readonly fetchFn: FetchLike = globalThis.fetch,
  ) {
    this.baseUrl = config.baseUrl ?? 'https://api.resend.com';
  }

  async send(message: OutboundMessage): Promise<{ providerMessageId: string }> {
    if (message.channel !== 'EMAIL') {
      throw new Error(`EmailAdapter cannot send channel ${message.channel}`);
    }
    const res = await this.fetchFn(`${this.baseUrl}/emails`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.from,
        to: message.recipient,
        subject: message.body.split('\n')[0],
        text: message.body,
      }),
    });
    const body = (await expectOk('resend', res)) as { id: string };
    return { providerMessageId: body.id };
  }
}
