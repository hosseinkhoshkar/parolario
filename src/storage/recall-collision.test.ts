import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AppState, LearningCommand } from '../contracts/index.ts'
import { lessonTwoBundle as bundle } from '../content/lesson-two.ts'
import { createInitialState, currentTask, transition } from '../learning/engine.ts'
import { loadState, migrateState, saveState, StorageError, validateState } from './index.ts'
import { indexedDBModel } from './test-idb.ts'

const NOW = '2026-11-10T12:00:00.000Z'

/** Synthetic answers only. Seed 1 with this error pattern reproduced the old
 * queue-length ID collision on step 29 after future tasks were removed. */
function errorSession(): AppState {
  let state = createInitialState(bundle, 'Europe/Berlin'), randomState = 1
  const apply = (command: LearningCommand) => {
    state = transition(state, command, bundle, NOW)
    if (state.session) assert.equal(new Set(state.session.queue.map(task => task.taskId)).size,
      state.session.queue.length, 'each new task must have a unique ID, even after pruning')
    validateState(state, bundle)
  }
  apply({ type: 'start-session', sessionId: 'synthetic-recall-collision', seed: 1 })
  for (let step = 1; currentTask(state) && step <= 250; step++) {
    const task = currentTask(state)!
    if (state.session!.feedback) { apply({ type: 'next', taskId: task.taskId }); continue }
    if (task.kind === 'flashcard') {
      apply({ type: 'reveal-card', taskId: task.taskId })
      apply({ type: 'next', taskId: task.taskId })
      continue
    }
    if (task.kind === 'reverse-card') throw new Error('Unexpected same-day reverse card')
    const id = task.kind === 'match' ? task.entryIds.find(id => !task.matchedEntryIds.includes(id))! : task.entryId
    const entry = bundle.entries.find(entry => entry.entryId === id)!
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
    const wrong = randomState / 4_294_967_296 < 0.35
    const answer = task.kind === 'cloze' || task.kind === 'write-word'
      ? wrong ? 'wrong' : task.kind === 'cloze' ? entry.cloze.acceptedAnswers[0] : entry.writing.acceptedAnswers[0]
      : task.kind === 'choose-article'
        ? wrong ? task.options.find(option => option !== entry.nounData!.article)! : entry.nounData!.article!
        : wrong ? task.kind === 'match'
          ? task.entryIds.find(other => other !== id && !task.matchedEntryIds.includes(other)) ?? id
          : task.optionIds.find(other => other !== id)! : id
    apply({ type: 'answer', taskId: task.taskId, attemptId: `synthetic-answer-${step}`, entryId: id, answer })
  }
  assert.equal(state.session!.state, 'ended')
  return state
}

function legacySnapshot() {
  const state = errorSession(), queue = state.session!.queue
  const first = queue.find(task => task.kind === 'write-word' && task.cycleKind === 'recovery'
    && queue.some(other => other !== task && other.kind === task.kind && other.entryId === task.entryId
      && other.cycleKind === 'recovery'))!
  assert.ok(first && first.kind === 'write-word')
  const second = queue.find(task => task !== first && task.kind === first.kind
    && task.entryId === first.entryId && task.cycleKind === 'recovery')!
  const originals = new Set([first.taskId, second.taskId])
  const legacyId = `${state.session!.sessionId}:recall:${first.entryId}:boundary-33-0`
  first.taskId = second.taskId = legacyId
  for (const attempt of state.attempts) if (originals.has(attempt.taskId)) attempt.taskId = legacyId
  return { state, legacyId }
}

test('repeated errors and queue pruning never reuse recall IDs and every intermediate snapshot reloads', () => {
  const state = errorSession()
  assert.ok(state.attempts.some(attempt => !attempt.correct))
  assert.ok(state.session!.queue.filter(task => task.kind === 'write-word' && task.cycleKind === 'recovery').length > 2)
})

test('completed legacy collisions load unchanged, retain all evidence, and allow a new session', async () => {
  const { state } = legacySnapshot(), original = structuredClone(state)
  assert.deepEqual(migrateState(state, bundle), original)
  const model = indexedDBModel(state), previous = globalThis.indexedDB
  globalThis.indexedDB = model.factory
  try {
    const loaded = (await loadState(bundle))!
    assert.deepEqual(loaded, original)
    assert.deepEqual(model.read(), original, 'recovery is read-only and does not rewrite prior evidence')
    const resumed = transition(loaded, { type: 'start-session', sessionId: 'after-legacy-recovery', seed: 8 }, bundle,
      '2026-11-12T12:00:00.000Z')
    validateState(resumed, bundle)
    assert.deepEqual(resumed.attempts, original.attempts)
    await saveState(resumed, loaded.revision)
    assert.equal((await loadState(bundle))!.session!.sessionId, 'after-legacy-recovery')
  } finally { globalThis.indexedDB = previous }
  assert.deepEqual(state, original)
})

test('unproven duplicate tasks and ambiguous live legacy queues are still rejected without mutation', () => {
  const mutators: ((state: AppState, id: string) => void)[] = [
    (state, id) => { state.session!.queue.push(structuredClone(state.session!.queue.find(task => task.taskId === id)!)); state.session!.cursor++ },
    (state, id) => {
      const index = state.session!.queue.findIndex(task => task.taskId === id)
      const task = state.session!.queue[index]
      if (task.kind === 'write-word') state.session!.queue[index] = { ...task, kind: 'cloze' }
    },
    state => { state.session!.state = 'paused'; state.session!.cursor-- },
    (state, id) => { for (const task of state.session!.queue) if (task.taskId === id) task.taskId = 'unrecognized-duplicate-id' },
    (state, id) => { state.session!.queue.find(task => task.taskId === id)!.assisted = true },
  ]
  for (const mutate of mutators) {
    const { state, legacyId } = legacySnapshot()
    mutate(state, legacyId)
    const original = structuredClone(state)
    assert.throws(() => migrateState(state, bundle), StorageError)
    assert.deepEqual(state, original)
  }
})
