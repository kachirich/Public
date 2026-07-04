import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';

// Unambiguous alphabet: no 0/O, 1/I/L.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function candidate(): string {
  const bytes = randomBytes(4);
  let code = 'R';
  for (let i = 0; i < 4; i++) code += ALPHABET[bytes[i]! % ALPHABET.length];
  return code;
}

export async function generateRefCode(pool: Pool): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = candidate();
    const { rows } = await pool.query(`SELECT 1 FROM requests WHERE ref_code = $1`, [code]);
    if (rows.length === 0) return code;
  }
  throw new Error('Could not generate a unique ref code');
}
