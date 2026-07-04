// Fuzzy match between the name a professional submitted and the name found
// in the registry. Normalizes case, token order, punctuation, and honorifics;
// initials match their full names at a discount. Returns 0..1.

const HONORIFICS = new Set(['dr', 'prof', 'mr', 'mrs', 'ms', 'eng', 'adv', 'cpa', 'rev']);

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !HONORIFICS.has(t));
}

const INITIAL_CREDIT = 0.9;

export function nameMatchScore(submitted: string, registryName: string): number {
  const a = tokens(submitted);
  const b = tokens(registryName);
  if (a.length === 0 || b.length === 0) return 0;

  // Greedy best-pair matching: exact token = 1, initial-to-name = 0.9.
  const remaining = [...b];
  let credit = 0;
  for (const t of a) {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i]!;
      let score = 0;
      if (r === t) score = 1;
      else if (t.length === 1 && r.startsWith(t)) score = INITIAL_CREDIT;
      else if (r.length === 1 && t.startsWith(r)) score = INITIAL_CREDIT;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      credit += bestScore;
      remaining.splice(bestIdx, 1);
    }
  }

  // Penalize unmatched tokens on both sides...
  const balanced = (2 * credit) / (a.length + b.length);

  // ...but registry records routinely carry extra middle names. When every
  // submitted token (>= 2 of them) matched exactly, the extra registry
  // tokens are verbosity, not disagreement — floor the score at 0.9.
  const fullExactSubset = a.length >= 2 && credit === a.length;
  return round3(fullExactSubset ? Math.max(balanced, 0.9) : balanced);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export const NAME_MATCH_THRESHOLD = 0.85;
