import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AppState, LearningCommand } from '../contracts/index.ts'
import type { AppState as VersionThreeState } from '../contracts/legacy-v3.ts'
import { lessonOneBundle as bundle } from '../content/lesson-one.ts'
import { createInitialState, currentTask, transition } from '../learning/engine.ts'
import { loadState, migrateState, saveState, validateState } from './index.ts'
import { validateVersionThreeState } from './legacy-v3.ts'
import { indexedDBModel } from './test-idb.ts'

const learnedAt = '2026-10-28T12:00:00.000Z'
const tomorrow = '2026-10-29T12:00:00.000Z'
function fifteenLearned(): AppState {
  let state = createInitialState(bundle, 'Europe/Berlin')
  let counter = 0
  const apply = (command: LearningCommand) => { state = transition(state, command, bundle, learnedAt); validateState(state, bundle) }
  for (let batch = 0; batch < 3; batch++) {
    apply({ type: 'start-session', sessionId: `migration-${batch}`, seed: batch + 1 })
    for (let step = 0; currentTask(state); step++) {
      assert.ok(step < 150)
      const task = currentTask(state)!
      if (state.session!.feedback) { apply({ type: 'next', taskId: task.taskId }); continue }
      if (task.kind === 'flashcard') {
        apply({ type: 'reveal-card', taskId: task.taskId }); apply({ type: 'next', taskId: task.taskId }); continue
      }
      assert.notEqual(task.kind, 'reverse-card')
      if (task.kind === 'reverse-card') throw new Error('No same-day reverse expected')
      const id = task.kind === 'match' ? task.entryIds.find(id => !task.matchedEntryIds.includes(id))! : task.entryId
      const entry = bundle.entries.find(entry => entry.entryId === id)!
      const answer = task.kind === 'cloze' ? entry.cloze.acceptedAnswers[0]
        : task.kind === 'write-word' ? entry.writing.acceptedAnswers[0]
          : task.kind === 'choose-article' ? entry.nounData!.article : id
      apply({ type: 'answer', taskId: task.taskId, attemptId: `learn-${counter++}`, entryId: id, answer })
    }
  }
  assert.equal(Object.keys(state.reverseProgress).length, 15)
  return state
}
function oldSnapshot(): VersionThreeState {
  const { reverseProgress, reverseReviews, ...old } = fifteenLearned()
  void reverseProgress; void reverseReviews
  const legacy = { ...old, schemaVersion: 3, session: old.session ? { ...old.session,
    queue: old.session.queue.filter(task => task.kind !== 'reverse-card') } : null } as VersionThreeState
  validateVersionThreeState(legacy, bundle)
  return legacy
}

test('V3 evidence migration preserves prior data and earns eligibility without inventing reverse successes', () => {
  const old = oldSnapshot(), before = structuredClone(old)
  const migrated = migrateState(old, bundle)
  validateState(migrated, bundle)
  assert.deepEqual(old, before)
  assert.equal(migrated.schemaVersion, 4)
  assert.equal(migrated.revision, old.revision + 1)
  for (const key of ['progress', 'attempts', 'session', 'savedSessions', 'assistanceEvents', 'dailyActivity', 'activityEventIds'] as const) {
    assert.deepEqual(migrated[key], old[key])
  }
  assert.equal(Object.keys(migrated.reverseProgress).length, 15)
  assert.deepEqual(migrated.reverseReviews, [])
  for (const progress of Object.values(migrated.reverseProgress)) {
    assert.equal(progress.correctCount, 0); assert.equal(progress.incorrectCount, 0)
    assert.equal(progress.lastReviewedAt, null); assert.equal(progress.nextDueAt, tomorrow)
  }
  const started = transition(migrated, { type: 'start-session', sessionId: 'eligible', seed: 4 }, bundle, tomorrow)
  assert.equal(started.session!.queue.filter(task => task.kind === 'reverse-card').length, 2)
  validateState(started, bundle)
  assert.deepEqual(migrateState(migrated, bundle), migrated)
  assert.throws(() => validateVersionThreeState(migrated, bundle))
})

test('V3 transaction abort preserves its snapshot; retry writes V4 once and old readers cannot overwrite it', async () => {
  const old = oldSnapshot(), model = indexedDBModel(old)
  const original = globalThis.indexedDB
  globalThis.indexedDB = model.factory
  try {
    model.failNextPut()
    await assert.rejects(loadState(bundle))
    assert.deepEqual(model.read(), old)
    const state = (await loadState(bundle))!
    assert.equal(state.schemaVersion, 4)
    assert.equal(state.revision, old.revision + 1)
    const again = (await loadState(bundle))!
    assert.equal(again.revision, state.revision)
    assert.deepEqual(again.reverseProgress, state.reverseProgress)
    const paused = transition(state, { type: 'start-session', sessionId: 'after-upgrade', seed: 2 }, bundle, tomorrow)
    await saveState(paused, state.revision)
    assert.deepEqual((await loadState(bundle))!.reverseProgress, paused.reverseProgress)
  } finally { globalThis.indexedDB = original }
})

test('V4 rejects missing reverse state, unearned completion, altered counters and unknown snapshots without reset', () => {
  const valid = migrateState(oldSnapshot(), bundle)
  const firstId = Object.keys(valid.reverseProgress)[0]
  const unknown = bundle.entries.find(entry => !valid.reverseProgress[entry.entryId])!.entryId
  const broken = [
    { ...valid, schemaVersion: 99 },
    { ...valid, reverseProgress: undefined },
    { ...valid, reverseReviews: undefined },
    { ...valid, reverseProgress: { ...valid.reverseProgress, [firstId]: { ...valid.reverseProgress[firstId], correctCount: 1 } } },
    { ...valid, reverseProgress: { ...valid.reverseProgress, [unknown]: { ...valid.reverseProgress[firstId], entryId: unknown } } },
    { ...valid, reverseProgress: { ...valid.reverseProgress, [firstId]: { ...valid.reverseProgress[firstId], nextDueAt: learnedAt } } },
  ]
  for (const value of broken) {
    const original = structuredClone(value)
    assert.throws(() => migrateState(value, bundle))
    assert.deepEqual(value, original)
  }
})


test('a corrupted sub-threshold reverse queue fails closed before rating can create invalid history', () => {
  const state = fifteenLearned()
  const ids = new Set(Object.keys(state.progress).slice(0, 5))
  state.progress = Object.fromEntries(Object.entries(state.progress).filter(([id]) => ids.has(id)))
  state.attempts = state.attempts.filter(attempt => ids.has(attempt.entryId))
  state.reverseProgress = Object.fromEntries(Object.entries(state.reverseProgress).filter(([id]) => ids.has(id)))
  state.session = null
  const started = transition(state, { type: 'start-session', sessionId: 'corrupted', seed: 7 }, bundle, tomorrow)
  const entryId = [...ids][0]
  started.session!.queue = [{ taskId: 'injected-reverse', kind: 'reverse-card', entryId, revealed: true }]
  started.session!.cursor = 0
  assert.throws(() => validateState(started, bundle))
  assert.equal(transition(started, { type: 'rate-reverse', taskId: 'injected-reverse', reviewId: 'blocked', correct: true }, bundle, tomorrow), started)
})
