/* global URL */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8')

test('single-rocket security migration removes the permissive policy', () => {
  const migration = read('../supabase/migrations/0003_single_rocket_security_and_preferences.sql')
  assert.match(migration, /drop policy if exists "Users manage rocket preferences"/)
  assert.doesNotMatch(migration, /using\s*\(true\)/i)
  assert.match(migration, /rockets\.user_id = auth\.uid\(\)/)
})

test('planner preferences are versioned and constrained', () => {
  const migration = read('../supabase/migrations/0003_single_rocket_security_and_preferences.sql')
  assert.match(migration, /engine_version in \('legacy-v1', 'current-v2'\)/)
  assert.match(migration, /planner_max_mass > planner_min_mass/)
  assert.match(migration, /new\.version = old\.version \+ 1/)
})

test('generated output is ignored and Vercel is canonical', () => {
  assert.match(read('../.gitignore'), /^dist\/$/m)
  assert.equal(read('../vercel.json').includes('"framework": "vite"'), true)
  assert.equal(read('../.github/workflows/ci.yml').includes('deploy-pages'), false)
})
