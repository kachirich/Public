import type { MessagingPort, OutboundMessage } from '../ports/messaging.js';

// In-memory MessagingPort for tests: records everything, can be told to fail.
export class FakeMessagingPort implements MessagingPort {
  readonly sent: OutboundMessage[] = [];
  failNextSends = 0;

  async send(message: OutboundMessage): Promise<{ providerMessageId: string }> {
    if (this.failNextSends > 0) {
      this.failNextSends -= 1;
      throw new Error('FakeMessagingPort: simulated send failure');
    }
    this.sent.push(message);
    return { providerMessageId: `fake-${this.sent.length}` };
  }
}
