import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AppState, ContentBundle, LearningCommand } from '../contracts/index.ts'
import { lessonOneBundle } from '../testing/legacy-fixture.ts'
import { createInitialState, currentTask, getActiveLesson, getHomeStats, getLessons, transition } from './engine.ts'
import { validateState } from '../storage/index.ts'

const NOW = '2026-10-28T12:00:00.000Z'
const later = '2026-10-28T12:00:01.000Z'
const FIRST = lessonOneBundle.lesson.lessonId
const FOURTH = 'lesson-04'

// Synthetic lesson fixtures exercise ownership without claiming new book content.
const fourthEntries = lessonOneBundle.entries.map((entry, index) => ({
  ...entry, entryId: `fixture-four-${index}`, introducedInLessonId: FOURTH,
  meaningOptionEntryIds: entry.meaningOptionEntryIds.map(id => `fixture-four-${lessonOneBundle.entries.findIndex(item => item.entryId === id)}`),
}))
const fourth = { ...lessonOneBundle.lesson, lessonId: FOURTH, titleIt: 'Fixture lesson', introducedEntryIds: fourthEntries.map(entry => entry.entryId) }
const course: ContentBundle = { ...lessonOneBundle, contentVersion: 'course-a1-lessons-01-04-v1',
  lessons: [lessonOneBundle.lesson, fourth], entries: [...lessonOneBundle.entries, ...fourthEntries] }
function apply(state: AppState, command: LearningCommand, now = NOW): AppState {
  const next = transition(state, command, course, now)
  validateState(next, course)
  return next
}
function draftState(bundle = course): AppState {
  let state = transition(createInitialState(bundle, 'Europe/Berlin'), { type: 'start-session', sessionId: 'first-session', seed: 4 }, bundle, NOW)
  for (let index = 0; index < 8; index++) {
    const task = currentTask(state)!
    if (task.kind === 'cloze' || task.kind === 'write-word') return transition(state, { type: 'draft', taskId: task.taskId, value: 'پاسخ ناتمام' }, bundle, NOW)
    state = transition(state, task.kind === 'flashcard' ? { type: 'reveal-card', taskId: task.taskId }
      : { type: 'answer', taskId: task.taskId, attemptId: `first-${index}`, answer: task.kind === 'match' ? task.entryIds[0] : task.entryId }, bundle, NOW)
    state = transition(state, { type: 'next', taskId: task.taskId }, bundle, NOW)
  }
  throw new Error('Expected written task')
}
test('switching lesson preserves draft, queue, feedback and evidence and restores each independent session', () => {
  const first = draftState()
  const archived = { ...structuredClone(first.session!), state: 'paused' }
  let state = apply(first, { type: 'select-lesson', lessonId: FOURTH })
  assert.equal(state.activeLessonId, FOURTH)
  assert.equal(state.session, null)
  assert.deepEqual(state.savedSessions[FIRST], archived)
  assert.deepEqual(state.progress, first.progress)
  assert.deepEqual(state.attempts, first.attempts)
  state = apply(state, { type: 'start-session', sessionId: 'fourth-session', seed: 2 })
  assert.equal(state.session!.lessonId, FOURTH)
  for (const task of state.session!.queue) {
    const ids = task.kind === 'match' ? task.entryIds : task.kind === 'choose-meaning' ? task.optionIds : [task.entryId]
    assert.ok(ids.every(id => id.startsWith('fixture-four-')))
  }
  const fourthSession = { ...structuredClone(state.session!), state: 'paused' }
  const bothProgress = structuredClone(state.progress)
  state = apply(state, { type: 'select-lesson', lessonId: FIRST })
  assert.deepEqual(state.session, archived)
  assert.deepEqual(state.savedSessions[FOURTH], fourthSession)
  assert.equal(state.savedSessions[FIRST], undefined)
  assert.deepEqual(state.progress, bothProgress)
  state = apply(state, { type: 'start-session', sessionId: 'unused-new-session', seed: 9 })
  assert.equal(state.session!.sessionId, 'first-session')
  assert.equal(state.session!.draft, 'پاسخ ناتمام')
})

test('other-lesson overdue/errors never enter selected lesson queue or its statistics', () => {
  const state = draftState()
  const oldId = lessonOneBundle.entries[0].entryId
  state.progress[oldId].nextDueAt = NOW
  state.progress[oldId].pendingError = { sessionId: 'old-error', remainingOtherAnswers: 0, at: NOW, reason: 'wrong-answer' }
  let selected = apply(state, { type: 'select-lesson', lessonId: FOURTH })
  const before = getHomeStats(selected, course, NOW)
  assert.equal(before.due, 0)
  assert.equal(before.introduced, 0)
  assert.equal(before.newCount, fourthEntries.length)
  assert.equal(before.totalAnswers, 0)
  selected = apply(selected, { type: 'start-session', sessionId: 'only-four', seed: 1 })
  assert.ok(selected.session!.queue.every(task => task.kind === 'match'
    ? task.entryIds.every(id => id !== oldId) : task.entryId !== oldId))
  assert.deepEqual(selected.progress[oldId], state.progress[oldId])
  assert.equal(getActiveLesson(selected, course).lessonId, FOURTH)
  assert.equal(getLessons(course).length, 2)
  assert.equal(getLessons(lessonOneBundle).length, 1)
})

test('daily twenty-minute activity stays global across lesson switches', () => {
  let state = draftState()
  state = apply(state, { type: 'activity', eventId: 'activity-first', sessionId: state.session!.sessionId, from: NOW, to: later, elapsedMs: 1000 }, later)
  assert.equal(getHomeStats(state, course, later).todayActiveMs, 1000)
  state = apply(state, { type: 'select-lesson', lessonId: FOURTH }, later)
  state = apply(state, { type: 'start-session', sessionId: 'four-time', seed: 3 }, later)
  const end = '2026-10-28T12:00:02.000Z'
  state = apply(state, { type: 'activity', eventId: 'activity-fourth', sessionId: 'four-time', from: later, to: end, elapsedMs: 1000 }, end)
  assert.equal(getHomeStats(state, course, end).todayActiveMs, 2000)
  state = apply(state, { type: 'select-lesson', lessonId: FIRST }, end)
  assert.equal(getHomeStats(state, course, end).todayActiveMs, 2000)
})

test('unknown/same lesson selection is a no-op and cross-lesson/duplicate saved sessions are rejected', () => {
  let state = draftState()
  assert.equal(transition(state, { type: 'select-lesson', lessonId: 'missing' }, course, NOW), state)
  assert.equal(transition(state, { type: 'select-lesson', lessonId: FIRST }, course, NOW), state)
  state = apply(state, { type: 'select-lesson', lessonId: FOURTH })
  assert.equal(transition(state, { type: 'start-session', sessionId: 'first-session', seed: 4 }, course, NOW), state)
  state = apply(state, { type: 'start-session', sessionId: 'four', seed: 4 })
  const cross = structuredClone(state)
  cross.savedSessions[FIRST].lessonId = FOURTH
  assert.throws(() => validateState(cross, course))
  const duplicate = structuredClone(state)
  duplicate.savedSessions[FIRST].sessionId = duplicate.session!.sessionId
  assert.throws(() => validateState(duplicate, course))
  const wrongTask = structuredClone(state)
  wrongTask.session!.queue[0] = { taskId: 'wrong-lesson-card', kind: 'flashcard', revealed: false, entryId: lessonOneBundle.entries[0].entryId }
  assert.throws(() => validateState(wrongTask, course))
})
