export type MessageChannel = 'WHATSAPP' | 'EMAIL' | 'TELEGRAM';

export interface OutboundMessage {
  channel: MessageChannel;
  /** E.164 phone number or email address, per channel. */
  recipient: string;
  body: string;
}

export interface MessagingPort {
  send(message: OutboundMessage): Promise<{ providerMessageId: string }>;
}
