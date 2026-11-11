import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { watchSessionRestore } from './authStartup.mjs'

test('a hung refresh offers recovery and still accepts a late restored session', async () => {
  let resolve
  const pending = new Promise(done => { resolve = done })
  const failures = [], sessions = []
  const stop = watchSessionRestore(() => pending, session => sessions.push(session), message => failures.push(message), 5)
  await delay(20)
  assert.equal(failures.length, 1)
  assert.match(failures[0], /have not been cleared/)
  const session = { user: { id: 'existing-user' } }
  resolve({ data: { session }, error: null })
  await delay(0)
  assert.deepEqual(sessions, [session])
  stop()
})

test('failed session restoration is handled instead of leaving loading stuck', async () => {
  for (const restore of [() => Promise.reject(new Error('Network unavailable')), () => Promise.resolve({ data: { session: null }, error: { message: 'Refresh failed' } })]) {
    const errors = []
    const stop = watchSessionRestore(restore, () => assert.fail('must not use a failed session'), message => errors.push(message), 50)
    await delay(0)
    assert.equal(errors.length, 1)
    stop()
  }
})

test('leaving restoration cancels its timer and ignores late sessions', async () => {
  let resolve
  const pending = new Promise(done => { resolve = done })
  const stop = watchSessionRestore(() => pending, () => assert.fail('late session'), () => assert.fail('late failure'), 5)
  stop()
  resolve({ data: { session: null }, error: null })
  await delay(20)
})

test('successful restoration does not later show a timeout', async () => {
  const sessions = []
  const stop = watchSessionRestore(() => Promise.resolve({ data: { session: null }, error: null }), session => sessions.push(session), () => assert.fail('unexpected timeout'), 5)
  await delay(20)
  assert.deepEqual(sessions, [null])
  stop()
})
