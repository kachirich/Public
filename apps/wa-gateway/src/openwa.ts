// Thin client for the OpenWA EASY API (HTTP mode). Every method is a dumb
// passthrough — no business logic lives in this service.

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface OpenWaConfig {
  baseUrl: string;
  apiKey?: string;
}

export class OpenWaError extends Error {
  constructor(
    readonly endpoint: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`openwa ${endpoint}: HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = 'OpenWaError';
  }
}

// +2547XXXXXXXX -> 2547XXXXXXXX@c.us. Ids that already carry a WhatsApp
// suffix (group ids like 1234-5678@g.us) pass through untouched.
export function toChatId(e164OrChatId: string): string {
  if (e164OrChatId.includes('@')) return e164OrChatId;
  return `${e164OrChatId.replace(/^\+/, '')}@c.us`;
}

export class OpenWaClient {
  constructor(
    private readonly config: OpenWaConfig,
    private readonly fetchFn: FetchLike = globalThis.fetch,
  ) {}

  private async call(endpoint: string, args: Record<string, unknown>): Promise<unknown> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.apiKey) headers.api_key = this.config.apiKey;
    const res = await this.fetchFn(`${this.config.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ args }),
    });
    const text = await res.text();
    if (!res.ok) throw new OpenWaError(endpoint, res.status, text);
    const parsed = text ? JSON.parse(text) : {};
    return (parsed as { response?: unknown }).response ?? parsed;
  }

  async sendText(toE164: string, content: string): Promise<{ messageId: string }> {
    const response = await this.call('sendText', { to: toChatId(toE164), content });
    return { messageId: typeof response === 'string' ? response : JSON.stringify(response) };
  }

  async createGroup(name: string, participantE164s: string[]): Promise<{ groupId: string }> {
    const response = (await this.call('createGroup', {
      groupName: name,
      contacts: participantE164s.map(toChatId),
    })) as { gid?: { _serialized?: string } } | string;
    const groupId = typeof response === 'string' ? response : (response.gid?._serialized ?? JSON.stringify(response));
    return { groupId };
  }

  async addParticipant(groupId: string, participantE164: string): Promise<void> {
    await this.call('addParticipant', { groupId, participantId: toChatId(participantE164) });
  }

  async removeParticipant(groupId: string, participantE164: string): Promise<void> {
    await this.call('removeParticipant', { groupId, participantId: toChatId(participantE164) });
  }

  // OpenWA has no single "dissolve": empty the group, then leave it.
  async dissolveGroup(groupId: string, participantE164s: string[]): Promise<void> {
    for (const p of participantE164s) {
      await this.removeParticipant(groupId, p);
    }
    await this.call('leaveGroup', { groupId });
  }
}
