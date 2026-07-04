import type { RoomsPort } from '@marketplace/core';
import { expectOk, type FetchLike } from './http.js';
import type { WaGatewayConfig } from './wa-gateway-messaging.js';

// Consult-room operations go through apps/wa-gateway like every other
// WhatsApp interaction — the orchestrator never talks to OpenWA directly.
export class WaGatewayRoomsAdapter implements RoomsPort {
  constructor(
    private readonly config: WaGatewayConfig,
    private readonly fetchFn: FetchLike = globalThis.fetch,
  ) {}

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', 'x-internal-secret': this.config.sharedSecret };
  }

  async createRoom(name: string, participantE164s: string[]): Promise<{ roomId: string }> {
    const res = await this.fetchFn(`${this.config.baseUrl}/rooms`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ name, participants: participantE164s }),
    });
    const body = (await expectOk('wa-gateway', res)) as { roomId: string };
    return { roomId: body.roomId };
  }

  async dissolveRoom(roomId: string, participantE164s: string[]): Promise<void> {
    const res = await this.fetchFn(`${this.config.baseUrl}/rooms/dissolve`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ roomId, participants: participantE164s }),
    });
    await expectOk('wa-gateway', res);
  }
}
