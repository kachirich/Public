import { describe, expect, it } from 'vitest';
import { NAME_MATCH_THRESHOLD, nameMatchScore } from './name-match.js';

describe('nameMatchScore', () => {
  it('identical names score 1', () => {
    expect(nameMatchScore('John Kamau', 'John Kamau')).toBe(1);
  });

  it('is case-insensitive and ignores punctuation', () => {
    expect(nameMatchScore('JOHN KAMAU', 'john kamau')).toBe(1);
    expect(nameMatchScore('John Kamau-Njoroge', 'John Kamau Njoroge')).toBe(1);
  });

  it('token order does not matter', () => {
    expect(nameMatchScore('Kamau John', 'John Kamau')).toBe(1);
  });

  it('honorifics are ignored', () => {
    expect(nameMatchScore('Dr John Kamau', 'John Kamau')).toBe(1);
    expect(nameMatchScore('John Kamau', 'Prof. John Kamau')).toBe(1);
  });

  it('initials match their full names at a discount', () => {
    const score = nameMatchScore('J. Kamau', 'John Kamau');
    expect(score).toBeGreaterThanOrEqual(NAME_MATCH_THRESHOLD);
    expect(score).toBeLessThan(1);
  });

  it('an extra middle name in the registry still clears the threshold', () => {
    // Submitted tokens are a full exact subset of the registry record.
    expect(nameMatchScore('John Kamau', 'John Mwangi Kamau')).toBeGreaterThanOrEqual(NAME_MATCH_THRESHOLD);
  });

  it('the subset floor needs at least two exact tokens', () => {
    // A single shared surname must not clear the bar.
    expect(nameMatchScore('Kamau', 'John Mwangi Kamau')).toBeLessThan(NAME_MATCH_THRESHOLD);
  });

  it('different people score low', () => {
    expect(nameMatchScore('John Kamau', 'Peter Otieno')).toBeLessThan(0.3);
    expect(nameMatchScore('John Kamau', 'Jane Kamotho')).toBeLessThan(NAME_MATCH_THRESHOLD);
  });

  it('empty or honorific-only names score 0', () => {
    expect(nameMatchScore('', 'John Kamau')).toBe(0);
    expect(nameMatchScore('Dr.', 'John Kamau')).toBe(0);
  });
});
