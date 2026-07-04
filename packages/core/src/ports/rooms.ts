export interface RoomsPort {
  /** Create a WhatsApp group for the session. Returns the group/chat id. */
  createRoom(name: string, participantE164s: string[]): Promise<{ roomId: string }>;
  /** Remove participants and abandon the group. */
  dissolveRoom(roomId: string, participantE164s: string[]): Promise<void>;
}
