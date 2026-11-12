import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { AppState, ContentBundle, LearningCommand } from '../contracts/index.ts'
import { NORMALIZATION_VERSION, SCHEMA_VERSION } from '../contracts/index.ts'
import { courseBundle as bundle } from '../content/catalog.ts'
import { createInitialState, currentTask, transition } from '../learning/engine.ts'
import { WRITER_LOCK_NAME } from '../controller/startup-lock.ts'
import { DATABASE_NAME, loadState, migrateState, saveState, StorageError, validateState } from './index.ts'
import { indexedDBModel } from './test-idb.ts'

const NOW = '2026-11-07T12:00:00.000Z'
const germanSnapshot = JSON.parse(readFileSync(new URL('./fixtures/pre-lesson-five-schema4.json', import.meta.url), 'utf8'))

function readyState(content = bundle): AppState {
  let state = createInitialState(content, 'Europe/Berlin')
  const apply = (command: LearningCommand) => { state = transition(state, command, content, NOW); validateState(state, content) }
  apply({ type: 'start-session', sessionId: 'storage-italian', seed: 23 })
  for (let count = 0; count < 160; count++) {
    const task = currentTask(state)!
    assert.ok(task)
    if (task.kind === 'cloze' || task.kind === 'write-word') return state
    if (state.session!.feedback) { apply({ type: 'next', taskId: task.taskId }); continue }
    if (task.kind === 'flashcard') {
      apply({ type: 'reveal-card', taskId: task.taskId }); apply({ type: 'next', taskId: task.taskId })
    } else if (task.kind === 'match') {
      const id = task.entryIds.find(id => !task.matchedEntryIds.includes(id))!
      apply({ type: 'answer', taskId: task.taskId, attemptId: `setup-${count}`, entryId: id, answer: id })
    } else if (task.kind === 'reverse-card') throw new Error('No same-day reverse task expected')
    else {
      const entry = content.entries.find(entry => entry.entryId === task.entryId)!
      apply({ type: 'answer', taskId: task.taskId, attemptId: `setup-${count}`, answer: task.kind === 'choose-article' ? entry.nounData!.article! : entry.entryId })
    }
  }
  throw new Error('No written task reached')
}

test('Italian persistence and writer lock have identities independent from Wortzeit', async () => {
  assert.equal(SCHEMA_VERSION, 5)
  assert.equal(NORMALIZATION_VERSION, 'italian-answer-normalization-v2')
  assert.equal(DATABASE_NAME, 'parolario-progress')
  assert.equal(WRITER_LOCK_NAME, 'parolario-single-writer')
  const model = indexedDBModel(), opened: string[] = []
  const original = globalThis.indexedDB
  globalThis.indexedDB = { open(name: string, version?: number) { opened.push(name); return model.factory.open(name, version) } } as IDBFactory
  try {
    assert.equal(await loadState(bundle), null)
    assert.deepEqual(opened, ['parolario-progress'])
    assert.equal(model.read(), undefined)
  } finally { globalThis.indexedDB = original }
})

test('real German and foreign schema/content snapshots are rejected without mutating or replacing stored data', async () => {
  const current = readyState()
  const foreign: unknown[] = [germanSnapshot, ...[1, 2, 3, 99].map(schemaVersion => ({ ...structuredClone(germanSnapshot), schemaVersion })),
    { ...structuredClone(current), schemaVersion: 4 },
    { ...structuredClone(current), contentVersion: germanSnapshot.contentVersion },
    { ...structuredClone(current), contentVersion: 'unknown-italian-content' },
  ]
  for (const snapshot of foreign) {
    const originalValue = structuredClone(snapshot)
    assert.throws(() => migrateState(snapshot, bundle), StorageError)
    assert.deepEqual(snapshot, originalValue)
    const model = indexedDBModel(snapshot)
    const original = globalThis.indexedDB
    globalThis.indexedDB = model.factory
    try {
      await assert.rejects(loadState(bundle), StorageError)
      assert.deepEqual(model.read(), originalValue, 'failed load must preserve the foreign snapshot')
      assert.deepEqual(model.keys(), ['current'], 'rejection must not create a replacement record')
    } finally { globalThis.indexedDB = original }
  }
})

test('current Italian clone/load preserves raw answer, pending feedback, draft, queue, schedule and revision', async () => {
  let state = readyState()
  const task = currentTask(state)!
  assert.ok(task.kind === 'cloze' || task.kind === 'write-word')
  const entry = bundle.entries.find(entry => entry.entryId === task.entryId)!
  const canonical = task.kind === 'cloze' ? entry.cloze.acceptedAnswers[0] : entry.writing.acceptedAnswers[0]
  const raw = `  ${canonical.normalize('NFD')}  `
  state = transition(state, { type: 'draft', taskId: task.taskId, value: raw }, bundle, NOW)
  state = transition(state, { type: 'answer', taskId: task.taskId, attemptId: 'raw-preserved', answer: raw }, bundle, NOW)
  validateState(state, bundle)
  const originalValue = structuredClone(state)
  const restored = migrateState(state, bundle)
  assert.notEqual(restored, state)
  assert.deepEqual(restored, originalValue)
  assert.equal(restored.attempts.at(-1)!.answer, raw)
  const model = indexedDBModel(state), original = globalThis.indexedDB
  globalThis.indexedDB = model.factory
  try {
    const loaded = (await loadState(bundle))!
    assert.deepEqual(loaded, { ...originalValue, session: { ...originalValue.session!, state: 'paused' } })
    assert.deepEqual(model.read(), originalValue, 'loading current data does not rewrite or increment it')
    assert.deepEqual(await loadState(bundle), loaded)
  } finally { globalThis.indexedDB = original }
})

test('damaged Italian counts, article options and attempt/reverse history fail closed without mutation', () => {
  const noun = bundle.entries.find(entry => entry.partOfSpeech === 'noun' && entry.nounData?.article)!
  assert.ok(noun)
  const content: ContentBundle = { ...bundle, entries: bundle.entries.map(entry => ({ ...entry,
    introductionOrder: entry.entryId === noun.entryId ? 0 : entry.introductionOrder + 1,
  })) }
  const state = readyState(content)
  const mutators: ((state: AppState) => void)[] = [
    value => { Object.values(value.progress)[0].correctCount++ },
    value => { value.attempts.push(structuredClone(value.attempts[0])) },
    value => { (value.attempts[0] as unknown as { normalizationVersion: string }).normalizationVersion = 'answer-normalization-v2' },
    value => { const task = value.session!.queue.find(task => task.kind === 'choose-article')!; assert.equal(task.kind, 'choose-article'); if (task.kind === 'choose-article') task.options = [task.options[0], task.options[0], task.options[1]] },
    value => { const task = value.session!.queue.find(task => task.kind === 'choose-article')!; if (task.kind === 'choose-article') task.options = ['der', 'die', 'das'] as never },
    value => { value.reverseReviews.push({ reviewId: 'unearned-review', sessionId: 'foreign-review', taskId: 'no-reverse-task', entryId: noun.entryId, correct: true, at: NOW, studyDate: '2026-11-07' }) },
    value => { value.session!.cursor = value.session!.queue.length + 1 },
  ]
  for (const mutate of mutators) {
    const broken = structuredClone(state)
    mutate(broken)
    const unchanged = structuredClone(broken)
    assert.throws(() => validateState(broken, content), StorageError)
    assert.deepEqual(broken, unchanged)
  }
})

test('failed atomic Italian commit preserves draft and schedule; retry stores the same revision exactly once', async () => {
  const originalState = readyState()
  const task = currentTask(originalState)!
  const next = transition(originalState, { type: 'draft', taskId: task.taskId, value: 'risposta da conservare' }, bundle, NOW)
  validateState(next, bundle)
  const model = indexedDBModel(originalState), original = globalThis.indexedDB
  globalThis.indexedDB = model.factory
  try {
    model.failNextPut()
    await assert.rejects(saveState(next, originalState.revision), StorageError)
    assert.deepEqual(model.read(), originalState)
    await saveState(next, originalState.revision)
    assert.deepEqual(model.read(), next)
    await assert.rejects(saveState(next, originalState.revision), StorageError)
    assert.deepEqual(model.read(), next, 'a repeated stale revision cannot double-commit')
  } finally { globalThis.indexedDB = original }
})
