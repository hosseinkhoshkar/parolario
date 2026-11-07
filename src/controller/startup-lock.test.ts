import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { holdWriterLock, WRITER_LOCK_NAME } from './startup-lock.ts'

/** Controlled lock-service scheduling, not a browser/Web Locks implementation claim. */
class LockService {
  owned = true
  requests: LockOptions[] = []
  pending: { run: () => void; cancel: () => void }[] = []
  request(name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<void>): Promise<void> {
    this.requests.push(options)
    assert.equal(name, WRITER_LOCK_NAME)
    assert.ok(!(options.ifAvailable && options.signal))
    return new Promise((resolve, reject) => {
      const remove = () => { this.pending = this.pending.filter(item => item !== waiting) }
      const waiting = {
        cancel: () => { remove(); reject(new DOMException('Cancelled', 'AbortError')) },
        run: () => {
          remove()
          options.signal?.removeEventListener('abort', waiting.cancel)
          this.owned = true
          const finish = () => { this.owned = false; this.pending[0]?.run() }
          void Promise.resolve().then(() => callback({ name, mode: 'exclusive' })).then(
            () => { finish(); resolve() }, error => { finish(); reject(error) },
          )
        },
      }
      if (options.signal?.aborted) { waiting.cancel(); return }
      if (this.owned && options.ifAvailable) { void callback(null).then(resolve, reject); return }
      options.signal?.addEventListener('abort', waiting.cancel, { once: true })
      if (this.owned) this.pending.push(waiting)
      else waiting.run()
    })
  }
  closeOwner() { this.owned = false; this.pending[0]?.run() }
}

test('retry waits through transient contention, never reads before ownership, and preserves the loaded snapshot', async () => {
  const locks = new LockService()
  const stored = { revision: 18, attempts: [{ attemptId: 'saved-answer' }],
    progress: { e: { nextDueAt: '2026-10-30T12:00:00.000Z' } },
    session: { queue: ['q'], cursor: 0, draft: 'Guten Ta', state: 'paused' } }
  let loaded: typeof stored | null = null, blocked = 0
  const handlers = { load: async () => { loaded = structuredClone(stored) },
    blocked: () => { blocked++ }, failed: (error: unknown) => { throw error } }
  const stopProbe = holdWriterLock(locks, false, handlers)
  await setImmediate()
  assert.equal(blocked, 1)
  assert.equal(loaded, null)
  stopProbe()
  const stopRetry = holdWriterLock(locks, true, handlers)
  await setImmediate()
  assert.equal(locks.pending.length, 1)
  assert.equal(loaded, null)
  locks.closeOwner()
  await setImmediate()
  assert.deepEqual(loaded, stored)
  assert.equal(locks.owned, true, 'lock stays held for the writer lifetime')
  stopRetry()
  await setImmediate()
  assert.equal(locks.owned, false)
})

test('cancelling pending startup removes its request without reading or stealing from the owner', async () => {
  const locks = new LockService()
  let loads = 0, failures = 0
  const stop = holdWriterLock(locks, true, { load: async () => { loads++ }, blocked: () => {}, failed: () => { failures++ } })
  assert.equal(locks.pending.length, 1)
  stop()
  await setImmediate()
  assert.equal(locks.pending.length, 0)
  assert.equal(locks.owned, true)
  locks.closeOwner()
  await setImmediate()
  assert.equal(loads, 0)
  assert.equal(failures, 0)
})

test('cancelling during a slow read releases ownership and ignores its late result', async () => {
  const locks = new LockService()
  locks.owned = false
  let completeRead = () => {}, writers = 0
  const read = new Promise<void>(resolve => { completeRead = resolve })
  const stop = holdWriterLock(locks, true, { load: async signal => { await read; if (!signal.aborted) writers++ },
    blocked: () => {}, failed: (error: unknown) => { throw error } })
  await setImmediate()
  assert.equal(locks.owned, true)
  stop()
  await setImmediate()
  assert.equal(locks.owned, false)
  completeRead()
  await setImmediate()
  assert.equal(writers, 0)
})

test('failed boot releases the lock and a fresh startup can acquire it', async () => {
  const locks = new LockService()
  locks.owned = false
  let error: unknown, loaded = false
  const stop = holdWriterLock(locks, false, { load: async () => { throw new Error('read failed') },
    blocked: () => {}, failed: failure => { error = failure } })
  await setImmediate()
  assert.match(String(error), /read failed/)
  assert.equal(locks.owned, false)
  const next = holdWriterLock(locks, false, { load: async () => { loaded = true }, blocked: () => {}, failed: () => {} })
  await setImmediate()
  assert.equal(loaded, true)
  assert.equal(locks.owned, true)
  stop()
  next()
})
