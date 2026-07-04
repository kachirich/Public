import type { MessageChannel, MessagingPort, OutboundMessage } from '@marketplace/core';

// Composite MessagingPort: one port per channel. The outbox dispatcher only
// ever sees this; individual adapters stay single-channel.
export class ChannelRouterMessagingPort implements MessagingPort {
  constructor(private readonly routes: Partial<Record<MessageChannel, MessagingPort>>) {}

  async send(message: OutboundMessage): Promise<{ providerMessageId: string }> {
    const port = this.routes[message.channel];
    if (!port) throw new Error(`No messaging adapter configured for channel ${message.channel}`);
    return port.send(message);
  }
}
