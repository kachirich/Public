import * as chrono from 'chrono-node';

// Parses a professional's counter-offer message: up to 3 alternative times,
// one per line, natural language ("tomorrow 2pm", "Fri 10:30"). Lines that
// don't parse are reported back so the orchestrator can echo exactly what
// it understood and what it didn't — never silently guessed.

export const MAX_COUNTER_SLOTS = 3;

export interface ParsedSlot {
  raw: string;
  start: Date;
}

export interface CounterParseResult {
  slots: ParsedSlot[];
  /** Lines that chrono could not parse or that were in the past. */
  rejected: { raw: string; reason: 'UNPARSEABLE' | 'IN_PAST' }[];
  /** Parseable lines beyond the 3-slot cap, dropped. */
  overflow: string[];
}

export function parseCounterSlots(body: string, referenceDate: Date): CounterParseResult {
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const result: CounterParseResult = { slots: [], rejected: [], overflow: [] };

  for (const raw of lines) {
    const parsed = chrono.parseDate(raw, referenceDate, { forwardDate: true });
    if (!parsed) {
      result.rejected.push({ raw, reason: 'UNPARSEABLE' });
      continue;
    }
    if (parsed.getTime() <= referenceDate.getTime()) {
      result.rejected.push({ raw, reason: 'IN_PAST' });
      continue;
    }
    if (result.slots.length >= MAX_COUNTER_SLOTS) {
      result.overflow.push(raw);
      continue;
    }
    result.slots.push({ raw, start: parsed });
  }

  return result;
}
