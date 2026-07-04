import { describe, expect, it } from 'vitest';
import { parseReply, type ReplyIntent } from './reply.js';

function intent(body: string): ReplyIntent {
  return parseReply(body).intent;
}

describe('parseReply — numbered menu', () => {
  it.each([
    ['1', 'ACCEPT'],
    ['2', 'DECLINE'],
    ['3', 'DECLINE_WRONG_TIME'],
    ['4', 'DECLINE_NEED_INFO'],
    [' 1 ', 'ACCEPT'],
    ['1.', 'ACCEPT'],
    ['1)', 'ACCEPT'],
    ['1 please', 'ACCEPT'],
    ['2 sorry', 'DECLINE'],
    ['3 cant make it then', 'DECLINE_WRONG_TIME'],
    ['4 what is it about', 'DECLINE_NEED_INFO'],
  ] as const)('%j -> %s', (body, expected) => {
    expect(intent(body)).toBe(expected);
  });

  it('numbers that are not menu options are UNKNOWN', () => {
    expect(intent('10')).toBe('UNKNOWN');
    expect(intent('5')).toBe('UNKNOWN');
    expect(intent('12 noon works')).toBe('UNKNOWN');
  });
});

describe('parseReply — loose accepts and declines', () => {
  it.each(['yes', 'YES', 'accept', 'ok', 'Okay', 'sawa', 'confirm', 'sure', 'yeah', 'yep', 'ok thanks', 'yes please'])(
    '%j is an accept',
    (body) => {
      expect(['ACCEPT', 'CONFIRM_YES']).toContain(intent(body));
    },
  );

  it.each(['decline', 'reject', 'no thanks', "can't", 'cannot do it', 'pass'])('%j is a decline', (body) => {
    expect(['DECLINE', 'CONFIRM_NO']).toContain(intent(body));
  });

  it('bare yes/no map to counter-echo confirmation intents', () => {
    expect(intent('yes')).toBe('CONFIRM_YES');
    expect(intent('YES')).toBe('CONFIRM_YES');
    expect(intent('no')).toBe('CONFIRM_NO');
  });

  it('accept words hidden inside other words do not match', () => {
    expect(intent('broken')).toBe('UNKNOWN'); // contains "ok"
    expect(intent('yesterday was fine')).toBe('UNKNOWN'); // contains "yes"
    expect(intent('nothing')).toBe('UNKNOWN'); // contains "no"
  });

  it('mixed accept+decline signals are UNKNOWN, never guessed', () => {
    expect(intent('yes no maybe')).toBe('UNKNOWN');
    expect(intent('ok but no')).toBe('UNKNOWN');
  });
});

describe('parseReply — phrases', () => {
  it.each(['wrong time', 'can we do another time', 'need to reschedule', 'thats a bad time for me'])(
    '%j -> DECLINE_WRONG_TIME',
    (body) => {
      expect(intent(body)).toBe('DECLINE_WRONG_TIME');
    },
  );

  it.each(['need more info', 'send more details', 'what is this about'])('%j -> DECLINE_NEED_INFO', (body) => {
    expect(intent(body)).toBe('DECLINE_NEED_INFO');
  });
});

describe('parseReply — #REF extraction', () => {
  it('finds the ref anywhere and uppercases it', () => {
    expect(parseReply('#R4X2 1')).toEqual({ intent: 'ACCEPT', refCode: 'R4X2' });
    expect(parseReply('1 #r4x2')).toEqual({ intent: 'ACCEPT', refCode: 'R4X2' });
    expect(parseReply('accept #R4X2 thanks')).toEqual({ intent: 'ACCEPT', refCode: 'R4X2' });
    expect(parseReply('# R4X2 2')).toEqual({ intent: 'DECLINE', refCode: 'R4X2' });
  });

  it('a bare ref with no intent is UNKNOWN but keeps the ref', () => {
    expect(parseReply('#R4X2')).toEqual({ intent: 'UNKNOWN', refCode: 'R4X2' });
  });

  it('no ref -> null', () => {
    expect(parseReply('1').refCode).toBeNull();
  });
});

describe('parseReply — garbage input', () => {
  it.each(['', '   ', 'asdfghjkl', '🙂🙂🙂', 'hello', 'who is this?', 'STOP', 'https://spam.example', '?????'])(
    '%j -> UNKNOWN',
    (body) => {
      expect(intent(body)).toBe('UNKNOWN');
    },
  );
});
