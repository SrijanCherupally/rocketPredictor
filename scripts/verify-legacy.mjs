/* global URL, console */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const expected = {
  '../src/analytics.ts': '8f67eac0bc9069e0afd546f708526917b879066f6214d982ea4d8dd7320c0ba1',
  '../src/experiments.ts': '33270c1bc767ed9b63cba1b17fe9d199990039d30d79005c4b2b25565ec91f29',
}

for (const [relative, digest] of Object.entries(expected)) {
  const path = fileURLToPath(new URL(relative, import.meta.url))
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex')
  if (actual !== digest) throw new Error(`Legacy preservation check failed for ${relative}: ${actual}`)
}

console.log('Legacy v1 source hashes verified.')
