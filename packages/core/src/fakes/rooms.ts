import type { RoomsPort } from '../ports/rooms.js';

// In-memory RoomsPort recording created and dissolved rooms.
export class FakeRoomsPort implements RoomsPort {
  readonly created: { roomId: string; name: string; participants: string[] }[] = [];
  readonly dissolved: { roomId: string; participants: string[] }[] = [];
  private next = 1;

  async createRoom(name: string, participantE164s: string[]): Promise<{ roomId: string }> {
    const roomId = `fake-room-${this.next++}@g.us`;
    this.created.push({ roomId, name, participants: participantE164s });
    return { roomId };
  }

  async dissolveRoom(roomId: string, participantE164s: string[]): Promise<void> {
    this.dissolved.push({ roomId, participants: participantE164s });
  }
}
