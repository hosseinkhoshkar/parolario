import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AppState, LearningCommand, SessionTask } from '../contracts/index.ts'
import { courseBundle as bundle } from '../content/catalog.ts'
import { lessonOneBundle } from '../content/lesson-one.ts'
import { lessonTwoBundle } from '../content/lesson-two.ts'
import { hasArticle } from '../learning/articles.ts'
import { createInitialState, currentTask, getHomeStats, transition } from '../learning/engine.ts'
import { migrateState, validateState } from '../storage/index.ts'

const NOW = '2026-11-09T12:00:00.000Z'
let sequence = 0
function apply(state: AppState, command: LearningCommand): AppState {
  const next = transition(state, command, bundle, NOW)
  validateState(next, bundle)
  return next
}
function answerFor(task: SessionTask): Extract<LearningCommand, { type: 'answer' }> {
  if (task.kind === 'flashcard' || task.kind === 'reverse-card') throw new Error('A card cannot fabricate an answer attempt')
  const id = task.kind === 'match' ? task.entryIds.find(id => !task.matchedEntryIds.includes(id))! : task.entryId
  const entry = bundle.entries.find(entry => entry.entryId === id)!
  return { type: 'answer', taskId: task.taskId, attemptId: `lesson-two-answer-${++sequence}`, entryId: id,
    answer: task.kind === 'cloze' ? entry.cloze.acceptedAnswers[0]
      : task.kind === 'write-word' ? entry.writing.acceptedAnswers[0]
        : task.kind === 'choose-article' ? entry.nounData!.article! : id }
}
function step(state: AppState): AppState {
  const task = currentTask(state)!
  if (state.session!.feedback) return apply(state, { type: 'next', taskId: task.taskId })
  if (task.kind === 'flashcard') {
    state = apply(state, { type: 'reveal-card', taskId: task.taskId })
    return apply(state, { type: 'next', taskId: task.taskId })
  }
  return apply(state, answerFor(task))
}
function reachWriting(state: AppState): AppState {
  for (let count = 0; count < 200; count++) {
    const task = currentTask(state)
    assert.ok(task, 'a real lesson must reach a written exercise')
    if ((task.kind === 'write-word' || task.kind === 'cloze') && !state.session!.feedback) return state
    state = step(state)
  }
  throw new Error('Bounded real session did not reach writing')
}

test('every new lesson-two entry traverses the actual learning queue and every applicable exercise', () => {
  const lessonId = lessonTwoBundle.lesson.lessonId
  assert.equal(lessonId, 'it-a1-lesson-02')
  const entries = bundle.entries.filter(entry => entry.introducedInLessonId === lessonId)
  assert.equal(entries.length, lessonTwoBundle.entries.length)
  const expectedIds = new Set(entries.map(entry => entry.entryId))
  const introduced = new Set<string>(), exercised = new Map<string, Set<string>>()
  let state = apply(createInitialState(bundle, 'Europe/Berlin'), { type: 'select-lesson', lessonId })
  for (let batch = 0; batch < Math.ceil(entries.length / 5); batch++) {
    state = apply(state, { type: 'start-session', sessionId: `real-second-batch-${batch}`, seed: 109 + batch })
    const planned = state.session!.queue
    const cards = planned.filter(task => task.kind === 'flashcard')
    assert.equal(cards.length, Math.min(5, entries.length - batch * 5))
    const firstPractice = planned.findIndex(task => task.kind !== 'flashcard' && task.kind !== 'reverse-card')
    assert.ok(planned.findLastIndex(task => task.kind === 'flashcard') < firstPractice, 'the fresh batch presents its cards before practice')
    for (let count = 0; currentTask(state); count++) {
      assert.ok(count < 220, 'the lesson must finish without filler questions or a recovery loop')
      const task = currentTask(state)!
      if (state.session!.feedback) { state = step(state); continue }
      if (task.kind === 'flashcard') {
        assert.ok(expectedIds.has(task.entryId))
        const evidence = structuredClone(state.progress[task.entryId]), attempts = state.attempts.length
        state = apply(state, { type: 'reveal-card', taskId: task.taskId })
        assert.deepEqual(state.progress[task.entryId], evidence)
        assert.equal(state.attempts.length, attempts)
        state = apply(state, { type: 'next', taskId: task.taskId })
        continue
      }
      assert.notEqual(task.kind, 'reverse-card', 'same-day completion does not create a due reverse review')
      if (task.kind === 'reverse-card') throw new Error('Unexpected same-day reverse review')
      const ids = task.kind === 'match' ? task.entryIds : [task.entryId]
      assert.ok(ids.every(id => expectedIds.has(id)))
      if (task.kind === 'match' || task.kind === 'choose-meaning') {
        const options = task.kind === 'match' ? task.entryIds : task.optionIds
        assert.ok(options.every(id => expectedIds.has(id)), 'options stay within the selected real lesson')
        assert.equal(new Set(options.map(id => bundle.entries.find(entry => entry.entryId === id)!.meaningFa)).size, 4)
      }
      for (const id of ids) {
        const kinds = exercised.get(id) ?? new Set<string>()
        kinds.add(task.kind); exercised.set(id, kinds)
      }
      if (task.kind === 'choose-article') {
        const entry = bundle.entries.find(entry => entry.entryId === task.entryId)!
        assert.ok(hasArticle(entry), 'unknown or inapplicable articles produce no article task')
        assert.ok(task.options.includes(entry.nounData!.article!))
      }
      const command = answerFor(task)
      state = apply(state, command)
      assert.equal(state.session!.feedback!.correct, true)
      assert.equal(apply(state, command), state, 'duplicate submissions cannot count twice')
      assert.deepEqual(migrateState(state, bundle), state, 'every real answer has a valid restorable snapshot')
    }
    assert.equal(state.session!.state, 'ended')
    assert.ok(state.session!.introducedEntryIds.length <= 5)
    for (const id of state.session!.introducedEntryIds) { assert.ok(!introduced.has(id)); introduced.add(id) }
    assert.equal(getHomeStats(state, bundle, NOW).stabilized, 0)
  }
  assert.deepEqual(introduced, expectedIds)
  assert.equal(getHomeStats(state, bundle, NOW).newCount, 0)
  assert.ok(Object.keys(state.progress).every(id => expectedIds.has(id)))
  for (const entry of entries) {
    const kinds = exercised.get(entry.entryId)!
    for (const kind of ['choose-meaning', 'cloze', 'write-word']) assert.ok(kinds.has(kind), `${entry.entryId}: ${kind}`)
    assert.equal(kinds.has('choose-article'), hasArticle(entry))
    assert.equal(state.progress[entry.entryId].skills.article !== null, hasArticle(entry))
    assert.equal(state.progress[entry.entryId].initialRecallPending, false)
    assert.equal(state.progress[entry.entryId].wrongCount, 0)
  }
})

test('switching the two real lessons restores independent drafts, queues, feedback and cursor', () => {
  const firstId = lessonOneBundle.lesson.lessonId, secondId = lessonTwoBundle.lesson.lessonId
  let state = apply(createInitialState(bundle, 'Europe/Berlin'), { type: 'start-session', sessionId: 'real-first-draft', seed: 59 })
  state = reachWriting(state)
  state = apply(state, { type: 'draft', taskId: currentTask(state)!.taskId, value: 'prima risposta incompleta' })
  const first = { ...structuredClone(state.session!), state: 'paused' as const }
  const oldProgress = structuredClone(state.progress)
  state = apply(state, { type: 'select-lesson', lessonId: secondId })
  assert.deepEqual(state.savedSessions[firstId], first)
  state = apply(state, { type: 'start-session', sessionId: 'real-second-draft', seed: 60 })
  state = reachWriting(state)
  state = apply(state, { type: 'draft', taskId: currentTask(state)!.taskId, value: 'seconda risposta incompleta' })
  const second = { ...structuredClone(state.session!), state: 'paused' as const }
  for (const [id, progress] of Object.entries(oldProgress)) assert.deepEqual(state.progress[id], progress)
  state = migrateState(state, bundle)
  state = apply(state, { type: 'select-lesson', lessonId: firstId })
  assert.deepEqual(state.session, first)
  assert.deepEqual(state.savedSessions[secondId], second)
  state = apply(state, { type: 'start-session', sessionId: 'unused-first-resume', seed: 1 })
  assert.equal(state.session!.sessionId, first.sessionId)
  assert.equal(state.session!.draft, first.draft)
  state = apply(state, answerFor(currentTask(state)!))
  const feedback = structuredClone(state.session!.feedback), attempts = structuredClone(state.attempts)
  const queue = structuredClone(state.session!.queue), cursor = state.session!.cursor
  state = apply(state, { type: 'select-lesson', lessonId: secondId })
  assert.deepEqual(state.session, second)
  state = apply(state, { type: 'select-lesson', lessonId: firstId })
  assert.deepEqual(state.session!.feedback, feedback)
  assert.deepEqual(state.session!.queue, queue)
  assert.equal(state.session!.cursor, cursor)
  assert.deepEqual(state.attempts, attempts)
})
