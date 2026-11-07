import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lessonOneBundle as bundle } from '../testing/legacy-fixture.ts'
import { createInitialState, currentTask, transition } from '../learning/engine.ts'
import { CommandWriter } from './writer.ts'
import type { AppState } from '../contracts/index.ts'

const now = '2026-10-28T12:00:00.000Z'
function clozeState() {
  let state = transition(createInitialState(bundle, 'Europe/Berlin'), { type: 'start-session', sessionId: 's', seed: 2 }, bundle, now)
  for (let step = 0; step < 100; step++) {
    const task = currentTask(state)!
    if (task.kind === 'cloze' && !state.session!.feedback) return state
    if (state.session!.feedback) state = transition(state, { type: 'next', taskId: task.taskId }, bundle, now)
    else if (task.kind === 'flashcard') {
      state = transition(state, { type: 'reveal-card', taskId: task.taskId }, bundle, now)
      state = transition(state, { type: 'next', taskId: task.taskId }, bundle, now)
    } else {
      const entry = task.kind === 'match' ? null : bundle.entries.find(entry => entry.entryId === task.entryId)!
      const id = task.kind === 'match' ? task.entryIds.find(id => !task.matchedEntryIds.includes(id))! : entry!.entryId
      const answer = task.kind === 'write-word' ? entry!.writing.acceptedAnswers[0]
        : task.kind === 'choose-article' ? entry!.nounData!.article : id
      state = transition(state, { type: 'answer', taskId: task.taskId, attemptId: `setup-${step}`, entryId: id, answer }, bundle, now)
    }
  }
  throw new Error('No cloze task found in the bounded session')
}

test('failed draft commit retains later rapid edits and retry stores the displayed final text', async () => {
  const initial = clozeState(), task = currentTask(initial)!
  let persisted = structuredClone(initial), fail = true
  const seen: string[] = [], errors: unknown[] = []
  const writer = new CommandWriter(initial, { bundle, now: () => now,
    save: async (state, revision) => {
      assert.equal(revision, persisted.revision)
      if (fail) throw new Error('quota')
      persisted = structuredClone(state)
      seen.push(state.session!.draft)
    }, onSaved: () => {}, onBusy: () => {}, onError: error => { errors.push(error) },
  })
  const jobs = ['H', 'Ha', 'Hallo'].map(value => writer.submit({ type: 'draft', taskId: task.taskId, value }))
  await Promise.all(jobs.map(job => assert.rejects(job, /quota/)))
  assert.equal(persisted.session!.draft, '')
  fail = false
  await writer.retry()
  assert.deepEqual(seen, ['H', 'Ha', 'Hallo'])
  assert.equal(persisted.session!.draft, 'Hallo')
  assert.equal(errors.at(-1), null)
})

test('failed answer retry uses identical attempt ID and never announces an uncommitted state', async () => {
  const initial = clozeState(), task = currentTask(initial)!
  assert.equal(task.kind, 'cloze')
  const answer = bundle.entries.find(entry => entry.entryId === task.entryId)!.cloze.acceptedAnswers[0]
  let persisted = structuredClone(initial), fail = true
  const announced: AppState[] = []
  const writer = new CommandWriter(initial, { bundle, now: () => now,
    save: async state => { if (fail) throw new Error('disk'); persisted = structuredClone(state) },
    onSaved: state => { announced.push(state) }, onBusy: () => {}, onError: () => {},
  })
  const command = { type: 'answer' as const, taskId: task.taskId, attemptId: 'fixed-retry-id', answer }
  await assert.rejects(writer.submit(command), /disk/)
  assert.equal(announced.length, 0)
  assert.equal(persisted.attempts.length, initial.attempts.length)
  fail = false
  await writer.retry()
  assert.equal(persisted.attempts.filter(item => item.attemptId === command.attemptId).length, 1)
  const revision = persisted.revision
  await writer.submit(command)
  assert.equal(persisted.revision, revision)
})

test('closing a writer rejects new work and settles queued saves before ownership can be released', async () => {
  const initial = clozeState(), task = currentTask(initial)!
  let unblock = () => {}, released = false
  const gate = new Promise<void>(resolve => { unblock = resolve })
  const drafts: string[] = []
  const writer = new CommandWriter(initial, { bundle, now: () => now,
    save: async state => { await gate; drafts.push(state.session!.draft) },
    onSaved: () => {}, onBusy: () => {}, onError: () => {},
  })
  const first = writer.submit({ type: 'draft', taskId: task.taskId, value: 'Guten' })
  const second = writer.submit({ type: 'draft', taskId: task.taskId, value: 'Guten Ta' })
  const closing = writer.close().then(() => { released = true })
  const repeatedClose = writer.close()
  await assert.rejects(writer.submit({ type: 'draft', taskId: task.taskId, value: 'late' }), /نویسنده/)
  await assert.rejects(writer.retry(), /نویسنده/)
  assert.equal(released, false)
  unblock()
  await Promise.all([first, second, closing, repeatedClose])
  assert.deepEqual(drafts, ['Guten', 'Guten Ta'])
  assert.equal(released, true)
})


test('background time and draft commits do not disable UI, foreground queued behind them does', async () => {
  const initial = clozeState(), task = currentTask(initial)!
  const busy: boolean[] = []
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  const writer = new CommandWriter(initial, { bundle, now: () => now,
    save: async () => { await gate }, onSaved: () => {},
    onBusy: value => busy.push(value), onError: () => {},
  })
  const clock = writer.submit({ type: 'activity', eventId: 'clock', sessionId: initial.session!.sessionId,
    from: now, to: '2026-10-28T12:00:01.000Z', elapsedMs: 1000 })
  const draft = writer.submit({ type: 'draft', taskId: task.taskId, value: 'Hallo' })
  assert.deepEqual(busy, [])
  const pause = writer.submit({ type: 'pause' })
  assert.deepEqual(busy, [true])
  release()
  await Promise.all([clock, draft, pause])
  assert.deepEqual(busy, [true, false])
})

test('commands queued after a failed background save keep retry available', async () => {
  const initial = clozeState(), task = currentTask(initial)!
  let fail = true
  const busy: boolean[] = []
  let saved = initial
  const writer = new CommandWriter(initial, { bundle, now: () => now,
    save: async state => { if (fail) throw new Error('disk'); saved = state },
    onSaved: () => {}, onBusy: value => busy.push(value), onError: () => {},
  })
  await assert.rejects(writer.submit({ type: 'draft', taskId: task.taskId, value: 'Hallo' }), /disk/)
  await assert.rejects(writer.submit({ type: 'pause' }), /disk/)
  assert.deepEqual(busy, [])
  fail = false
  await writer.retry()
  assert.deepEqual(busy, [true, false])
  assert.equal(saved.session!.draft, 'Hallo')
  assert.equal(saved.session!.state, 'paused')
})


test('pause queued behind a synchronous no-op activity is committed before submit resolves', async () => {
  const initial = clozeState()
  let persisted = initial
  const writer = new CommandWriter(initial, { bundle, now: () => now,
    save: async state => { persisted = structuredClone(state) },
    onSaved: () => {}, onBusy: () => {}, onError: () => {},
  })
  const noOp = writer.submit({ type: 'activity', eventId: 'invalid-tick', sessionId: initial.session!.sessionId,
    from: now, to: now, elapsedMs: 0 })
  const pause = writer.submit({ type: 'pause' })
  await pause
  assert.equal(persisted.session!.state, 'paused')
  assert.equal(persisted.revision, initial.revision + 1)
  await noOp
})

test('a reentrant command added as a drain reports success is not stranded', async () => {
  const initial = clozeState()
  let persisted = initial, queued = false
  const writer = new CommandWriter(initial, { bundle, now: () => now,
    save: async state => { persisted = structuredClone(state) },
    onSaved: () => {}, onBusy: () => {}, onError: error => {
      if (error === null && !queued) { queued = true; void writer.submit({ type: 'pause' }) }
    },
  })
  await writer.submit({ type: 'activity', eventId: 'ignored', sessionId: initial.session!.sessionId,
    from: now, to: now, elapsedMs: 0 })
  assert.equal(persisted.session!.state, 'paused')
})
