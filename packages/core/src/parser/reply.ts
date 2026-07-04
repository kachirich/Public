// Parses inbound WhatsApp replies from professionals. Numbered replies are
// the contract (1 accept, 2 decline, 3 wrong time, 4 need info) but humans
// are loose, so common natural phrasings map too. Anything ambiguous is
// UNKNOWN — the orchestrator re-prompts, it never guesses.

export type ReplyIntent =
  | 'ACCEPT'
  | 'DECLINE'
  | 'DECLINE_WRONG_TIME'
  | 'DECLINE_NEED_INFO'
  | 'CONFIRM_YES' // confirming a counter-offer echo
  | 'CONFIRM_NO'
  | 'UNKNOWN';

export interface ParsedReply {
  intent: ReplyIntent;
  /** #REF code found anywhere in the message, uppercased, without the '#'. */
  refCode: string | null;
}

const REF_PATTERN = /#\s*([A-Z0-9]{3,8})\b/i;

// Whole-message matches after normalization. Checked before token scans so
// that e.g. "no" is CONFIRM_NO-able and "ok" can't hide inside "broken".
const EXACT: Record<string, ReplyIntent> = {
  '1': 'ACCEPT',
  yes: 'CONFIRM_YES',
  no: 'CONFIRM_NO',
  '2': 'DECLINE',
  '3': 'DECLINE_WRONG_TIME',
  '4': 'DECLINE_NEED_INFO',
};

const ACCEPT_WORDS = ['yes', 'accept', 'ok', 'okay', 'sawa', 'confirm', 'confirmed', 'sure', 'yeah', 'yep'];
const DECLINE_WORDS = ['no', 'decline', 'reject', 'pass', 'cannot', "can't", 'cant'];
const WRONG_TIME_PHRASES = ['wrong time', 'another time', 'different time', 'reschedule', 'not that time', 'bad time'];
const NEED_INFO_PHRASES = ['need info', 'more info', 'need more', 'more details', 'what is this about', 'tell me more'];

function normalize(body: string): string {
  return body
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'#]/gu, ' ') // punctuation/emoji -> space, keep # and '
    .replace(/\s+/g, ' ')
    .trim();
}

function hasWord(text: string, word: string): boolean {
  return new RegExp(`(?:^|\\s)${word.replace(/'/g, "'?")}(?:\\s|$)`).test(text);
}

export function parseReply(body: string): ParsedReply {
  const refMatch = body.match(REF_PATTERN);
  const refCode = refMatch?.[1] ? refMatch[1].toUpperCase() : null;

  // Drop the ref mention before intent parsing so "#R4X2 1" works.
  const text = normalize(body.replace(REF_PATTERN, ' '));
  if (text === '') return { intent: 'UNKNOWN', refCode };

  const exact = EXACT[text];
  if (exact) return { intent: exact, refCode };

  // Phrases before words: "wrong time" must not fall through to DECLINE
  // via a stray "no", and "need more info" must not read as anything else.
  for (const phrase of WRONG_TIME_PHRASES) {
    if (text.includes(phrase)) return { intent: 'DECLINE_WRONG_TIME', refCode };
  }
  for (const phrase of NEED_INFO_PHRASES) {
    if (text.includes(phrase)) return { intent: 'DECLINE_NEED_INFO', refCode };
  }

  // A leading menu number with trailing words still counts: "1 please".
  const leading = text.split(' ')[0];
  if (leading && ['1', '2', '3', '4'].includes(leading)) {
    return { intent: EXACT[leading] === 'ACCEPT' ? 'ACCEPT' : EXACT[leading]!, refCode };
  }

  const accepts = ACCEPT_WORDS.some((w) => hasWord(text, w));
  const declines = DECLINE_WORDS.some((w) => hasWord(text, w));
  if (accepts && !declines) return { intent: 'ACCEPT', refCode };
  if (declines && !accepts) return { intent: 'DECLINE', refCode };

  return { intent: 'UNKNOWN', refCode };
}
