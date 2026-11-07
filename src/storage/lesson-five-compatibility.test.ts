import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { AppState, LearningCommand } from '../contracts/index.ts'
import { courseBundle as bundle } from '../content/catalog.ts'
import { createInitialState, currentTask, getHomeStats, transition } from '../learning/engine.ts'
import { loadState, migrateState, saveState, validateState } from './index.ts'
import { indexedDBModel } from './test-idb.ts'

// Frozen before lesson-five registration, using the engine at 5cb293f.
const beforeFive: AppState = JSON.parse(readFileSync(new URL('./fixtures/pre-lesson-five-schema4.json', import.meta.url), 'utf8'))
const NOW = '2026-11-04T12:00:00.000Z'
let sequence = 0
function apply(state: AppState, command: LearningCommand, now = NOW): AppState {
  const next = transition(state, command, bundle, now)
  validateState(next, bundle)
  return next
}
function step(state: AppState, now = NOW): AppState {
  const task = currentTask(state)!
  if (state.session!.feedback) return apply(state, { type: 'next', taskId: task.taskId }, now)
  if (task.kind === 'flashcard' || task.kind === 'reverse-card') {
    state = apply(state, { type: 'reveal-card', taskId: task.taskId }, now)
    return apply(state, task.kind === 'flashcard' ? { type: 'next', taskId: task.taskId }
      : { type: 'rate-reverse', taskId: task.taskId, reviewId: `five-review-${++sequence}`, correct: true }, now)
  }
  const id = task.kind === 'match' ? task.entryIds.find(id => !task.matchedEntryIds.includes(id))! : task.entryId
  const entry = bundle.entries.find(entry => entry.entryId === id)!
  return apply(state, { type: 'answer', taskId: task.taskId, entryId: id, attemptId: `five-answer-${++sequence}`,
    answer: task.kind === 'choose-article' ? entry.nounData!.article : task.kind === 'write-word'
      ? entry.writing.acceptedAnswers[0] : task.kind === 'cloze' ? entry.cloze.acceptedAnswers[0] : id }, now)
}

test('pre-lesson-five schema-4 save loads unchanged: progress, sessions, drafts, schedules and reverse history', async t => {
  const previousBundle = { ...bundle, lessons: bundle.lessons!.filter(lesson => lesson.lessonId !== 'lesson-05'),
    entries: bundle.entries.filter(entry => entry.introducedInLessonId !== 'lesson-05'),
    sourceRefs: bundle.sourceRefs.filter(ref => ref.lessonId !== 'lesson-05') }
  validateState(beforeFive, previousBundle)
  assert.equal(beforeFive.contentVersion, 'course-a1-lessons-01-04-v1')
  assert.equal(bundle.contentVersion, beforeFive.contentVersion)
  assert.equal(Object.keys(beforeFive.progress).length, 20)
  assert.equal(beforeFive.reverseReviews.length, 2)
  assert.ok(beforeFive.session!.draft && beforeFive.savedSessions['a1-lesson-01'].draft)
  assert.deepEqual(migrateState(beforeFive, bundle), beforeFive)
  const previous = globalThis.indexedDB
  t.after(() => { globalThis.indexedDB = previous })
  const model = indexedDBModel(beforeFive)
  globalThis.indexedDB = model.factory
  model.failNextPut() // A compatible schema-4 load must not even attempt a migration write.
  assert.deepEqual(await loadState(bundle), beforeFive)
  assert.deepEqual(await loadState(bundle), beforeFive)
  assert.deepEqual(model.read(), beforeFive)
  assert.deepEqual(model.keys(), ['current'])
  assert.throws(() => migrateState({ ...beforeFive, contentVersion: 'unknown-course' }, bundle))
})

test('real lessons 4 and 5 preserve each pending task, queue and draft through switching and IndexedDB reload', async t => {
  let state = structuredClone(beforeFive)
  const fourth = structuredClone(state.session!)
  state = apply(state, { type: 'select-lesson', lessonId: 'lesson-05' })
  assert.equal(getHomeStats(state, bundle, NOW).newCount, 76)
  assert.equal(getHomeStats(state, bundle, NOW).introduced, 0)
  state = apply(state, { type: 'start-session', sessionId: 'new-fifth-session', seed: 4 })
  assert.equal(state.session!.queue.filter(task => task.kind === 'flashcard').length, 5)
  assert.ok(state.session!.introducedEntryIds.every(id => id.startsWith('a1-l05-')))
  for (let guard = 0; guard < 200; guard++) {
    const task = currentTask(state)!
    if (!state.session!.feedback && (task.kind === 'cloze' || task.kind === 'write-word')) break
    state = step(state)
  }
  assert.ok(['cloze', 'write-word'].includes(currentTask(state)!.kind))
  state = apply(state, { type: 'draft', taskId: currentTask(state)!.taskId, value: 'Entwurf aus Lektion fünf' })
  state = apply(state, { type: 'activity', eventId: 'fifth-activity', sessionId: state.session!.sessionId,
    from: NOW, to: '2026-11-04T12:00:01.000Z', elapsedMs: 1000 }, '2026-11-04T12:00:01.000Z')
  const fifth = { ...structuredClone(state.session!), state: 'paused' }
  state = apply(state, { type: 'select-lesson', lessonId: 'lesson-04' })
  assert.deepEqual(state.session, fourth)
  assert.deepEqual(state.savedSessions['lesson-05'], fifth)
  assert.equal(getHomeStats(state, bundle, NOW).todayActiveMs, 1000)
  const previous = globalThis.indexedDB
  t.after(() => { globalThis.indexedDB = previous })
  const model = indexedDBModel(state)
  globalThis.indexedDB = model.factory
  state = (await loadState(bundle))!
  for (const lessonId of ['lesson-05', 'lesson-04', 'lesson-05']) {
    const priorRevision = state.revision
    state = apply(state, { type: 'select-lesson', lessonId })
    await saveState(state, priorRevision)
    state = (await loadState(bundle))!
    assert.deepEqual(state.session, lessonId === 'lesson-04' ? fourth : fifth)
    assert.equal(getHomeStats(state, bundle, NOW).todayActiveMs, 1000)
    for (const [id, progress] of Object.entries(beforeFive.progress)) assert.deepEqual(state.progress[id], progress)
    assert.deepEqual(state.savedSessions['a1-lesson-01'], beforeFive.savedSessions['a1-lesson-01'])
  }
  state = apply(state, { type: 'start-session', sessionId: 'must-not-replace-pending', seed: 99 })
  assert.equal(state.session!.sessionId, fifth.sessionId)
  assert.equal(state.session!.draft, fifth.draft)
  assert.deepEqual(state.session!.queue, fifth.queue)
})

test('lesson-five completions enter the shared reverse review pool with five new words and independent schedules', () => {
  let state = apply(createInitialState(bundle, 'Europe/Berlin'), { type: 'select-lesson', lessonId: 'lesson-05' })
  for (let batch = 0; batch < 3; batch++) {
    state = apply(state, { type: 'start-session', sessionId: `fifth-complete-${batch}`, seed: batch + 1 })
    for (let guard = 0; currentTask(state); guard++) { assert.ok(guard < 200); state = step(state) }
    state = apply(state, { type: 'end-session' })
  }
  assert.equal(Object.keys(state.reverseProgress).length, 15)
  const tomorrow = '2026-11-05T12:00:00.000Z'
  state = apply(state, { type: 'select-lesson', lessonId: 'lesson-04' }, tomorrow)
  state = apply(state, { type: 'start-session', sessionId: 'fourth-with-fifth-reverse', seed: 8 }, tomorrow)
  const reverse = state.session!.queue.filter(task => task.kind === 'reverse-card')
  assert.equal(reverse.length, 2)
  assert.ok(reverse.every(task => task.entryId.startsWith('a1-l05-') && !task.revealed))
  assert.equal(state.session!.queue.filter(task => task.kind === 'flashcard').length, 5)
  assert.ok(state.session!.introducedEntryIds.every(id => id.startsWith('a1-l04-')))
  while (currentTask(state)!.kind !== 'reverse-card') state = step(state, tomorrow)
  const before = structuredClone(state.progress)
  state = step(state, tomorrow)
  assert.equal(state.reverseReviews.length, 1)
  assert.deepEqual(state.progress, before)
})
