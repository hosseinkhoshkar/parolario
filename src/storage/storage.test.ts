import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lessonOneBundle } from '../testing/legacy-fixture.ts'
import { createInitialState, currentTask, transition } from '../learning/engine.ts'
import { saveState, StorageError, validateState } from './index.ts'

const NOW = '2026-10-28T12:00:00.000Z'
function sampleState() {
  let state = createInitialState(lessonOneBundle, 'Europe/Berlin')
  state = transition(state, { type: 'start-session', sessionId: 'storage-test', seed: 3 }, lessonOneBundle, NOW)
  while (currentTask(state)?.kind === 'flashcard') {
    const card = currentTask(state)!
    state = transition(state, { type: 'reveal-card', taskId: card.taskId }, lessonOneBundle, NOW)
    state = transition(state, { type: 'next', taskId: card.taskId }, lessonOneBundle, NOW)
  }
  const task = currentTask(state)!
  if (task.kind !== 'choose-meaning') throw new Error('meaning expected')
  return transition(state, { type: 'answer', taskId: task.taskId, attemptId: 'stored-attempt', answer: task.entryId }, lessonOneBundle, NOW)
}

test('a complete answer/progress/feedback/cursor snapshot survives cloning and validates', () => {
  const state = sampleState()
  const restored = structuredClone(state)
  validateState(restored, lessonOneBundle)
  assert.deepEqual(restored, state)
  assert.equal(restored.attempts.length, 1)
  assert.equal(restored.session!.feedback!.attemptId, restored.attempts[0].attemptId)
})

test('unknown versions, missing fields and unknown entry IDs are rejected without mutation', () => {
  const original = sampleState()
  const brokenStates = [
    null,
    { ...original, schemaVersion: 7 },
    { ...original, contentVersion: 'unavailable-content' },
    { ...original, learningPolicyVersion: 'other-policy' },
    { ...original, settings: { studyTimeZone: 'Fake/Zone', maxNewPerSession: 5 } },
    { ...original, progress: { ...original.progress, unknown: Object.values(original.progress)[0] } },
    { ...original, attempts: undefined },
  ]
  for (const broken of brokenStates) {
    const before = structuredClone(broken)
    assert.throws(() => validateState(broken, lessonOneBundle), StorageError)
    assert.deepEqual(broken, before)
  }
  assert.deepEqual(original, sampleState())
})

test('damaged cursor, duplicate IDs, mismatched counters and broken game pairs are rejected', () => {
  const mutators = [
    (state: ReturnType<typeof sampleState>) => { state.session!.cursor = 9_999 },
    (state: ReturnType<typeof sampleState>) => { state.attempts.push(structuredClone(state.attempts[0])) },
    (state: ReturnType<typeof sampleState>) => { state.session!.queue.push(structuredClone(state.session!.queue[0])) },
    (state: ReturnType<typeof sampleState>) => { Object.values(state.progress)[0].correctCount++ },
    (state: ReturnType<typeof sampleState>) => { Object.values(state.progress)[0].intervalIndex = 99 },
    (state: ReturnType<typeof sampleState>) => {
      const match = state.session!.queue.find(task => task.kind === 'match')!
      if (match.kind === 'match') match.rightOrder = [match.entryIds[0], match.entryIds[0], ...match.entryIds.slice(2)]
    },
    (state: ReturnType<typeof sampleState>) => { state.session!.feedback!.attemptId = 'missing' },
    (state: ReturnType<typeof sampleState>) => { state.session!.feedback = null },
    (state: ReturnType<typeof sampleState>) => { state.session!.targetAcknowledged = true },
    (state: ReturnType<typeof sampleState>) => { state.session!.targetAcknowledgedDate = '2026-10-28' },
  ]
  for (const mutate of mutators) {
    const state = sampleState()
    mutate(state)
    assert.throws(() => validateState(state, lessonOneBundle), StorageError)
  }
})

test('a nonsequential revision is refused before any IndexedDB mutation', async () => {
  const state = sampleState()
  await assert.rejects(saveState(state, state.revision), /ترتیب ذخیره/)
})
