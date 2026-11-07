import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AppState, LearningCommand, SessionTask } from '../contracts/index.ts'
import { courseBundle as bundle } from '../content/catalog.ts'
import { createInitialState, currentTask, transition } from './engine.ts'
import { validateState } from '../storage/index.ts'
import { calendarDaysAfter, deriveInitialReverseProgress, initializeReverseProgress, mixReverseCards,
  REVERSE_ACTIVATION_COUNT, REVERSE_MAX_INTERVAL_DAYS, reverseStudyDate, scheduleReverseReview, selectReverseEntries } from './reverse.ts'

const NOW = '2026-03-26T12:00:00.000Z'
const TOMORROW = '2026-03-27T12:00:00.000Z'
let sequence = 0
function apply(state: AppState, command: LearningCommand, now = NOW): AppState {
  const next = transition(state, command, bundle, now)
  validateState(next, bundle)
  return next
}
function start(state: AppState, now = NOW, seed = 42): AppState {
  return apply(state, { type: 'start-session', sessionId: `reverse-session-${++sequence}`, seed }, now)
}
function perform(state: AppState, now = NOW, correct = true): AppState {
  const task = currentTask(state)!
  if (state.session!.feedback) return apply(state, { type: 'next', taskId: task.taskId }, now)
  if (task.kind === 'flashcard' || task.kind === 'reverse-card') {
    state = apply(state, { type: 'reveal-card', taskId: task.taskId }, now)
    return task.kind === 'reverse-card'
      ? apply(state, { type: 'rate-reverse', taskId: task.taskId, reviewId: `review-${++sequence}`, correct }, now)
      : apply(state, { type: 'next', taskId: task.taskId }, now)
  }
  const entryId = task.kind === 'match' ? task.entryIds.find(id => !task.matchedEntryIds.includes(id))! : task.entryId
  const entry = bundle.entries.find(entry => entry.entryId === entryId)!
  const answer = task.kind === 'cloze' ? entry.cloze.acceptedAnswers[0]
    : task.kind === 'write-word' ? entry.writing.acceptedAnswers[0]
      : task.kind === 'choose-article' ? entry.nounData!.article : entryId
  return apply(state, { type: 'answer', taskId: task.taskId, entryId, attemptId: `attempt-${++sequence}`, answer }, now)
}
function finish(state: AppState, now = NOW): AppState {
  let steps = 0
  while (currentTask(state)) { assert.ok(steps++ < 200); state = perform(state, now) }
  return state
}
function fifteen(): AppState {
  let state = createInitialState(bundle, 'Europe/Berlin')
  for (let i = 0; i < 3; i++) state = finish(start(state))
  assert.equal(Object.keys(state.reverseProgress).length, 15)
  return state
}
function fourth(state: AppState, now = TOMORROW, seed = 42): AppState {
  return start(apply(state, { type: 'select-lesson', lessonId: 'lesson-04' }, now), now, seed)
}
function toReverse(state: AppState, now = TOMORROW): AppState {
  let steps = 0
  while (currentTask(state)?.kind !== 'reverse-card') { assert.ok(steps++ < 200); state = perform(state, now) }
  return state
}
function reverseTasks(state: AppState) {
  return state.session!.queue.filter((task): task is Extract<SessionTask, { kind: 'reverse-card' }> => task.kind === 'reverse-card')
}

test('15 unique actually completed words activate reverse only in subsequent eligible sessions', () => {
  let state = createInitialState(bundle, 'Europe/Berlin')
  for (let i = 0; i < 2; i++) state = finish(start(state))
  assert.equal(Object.keys(state.reverseProgress).length, 10)
  state = start(state)
  let observedFourteen = false
  while (currentTask(state)) {
    if (Object.keys(state.reverseProgress).length === REVERSE_ACTIVATION_COUNT - 1) {
      observedFourteen = true
      assert.deepEqual(selectReverseEntries(state, bundle, [], TOMORROW, 1), [])
    }
    state = perform(state)
    assert.equal(reverseTasks(state).length, 0, 'activation never changes an already planned session')
  }
  assert.equal(observedFourteen, true)
  assert.equal(Object.keys(state.reverseProgress).length, 15)
  assert.equal(reverseTasks(fourth(state, NOW)).length, 0, 'freshly learned words are not due')
  const due = fourth(state)
  assert.equal(reverseTasks(due).length, 2)
  assert.equal(due.activeLessonId, 'lesson-04')
  assert.equal(due.session!.queue.filter(task => task.kind === 'flashcard').length, 5)
  assert.equal(new Set(reverseTasks(due).map(task => task.entryId)).size, 2)
  assert.ok(reverseTasks(due).every(task => !task.entryId.startsWith('a1-l04-')))
})

test('completion reconstructs earliest clean meaning, independent writing and known noun article, never mere introductions', () => {
  const state = fifteen()
  const derived = deriveInitialReverseProgress(state, bundle)
  assert.equal(Object.keys(derived).length, 15)
  const noun = bundle.entries.find(entry => derived[entry.entryId] && entry.nounData)!
  const noArticle = { ...state, attempts: state.attempts.filter(attempt => !(attempt.entryId === noun.entryId && attempt.exercise === 'choose-article')) }
  assert.equal(deriveInitialReverseProgress(noArticle, bundle)[noun.entryId], undefined)
  const noCleanWriting = { ...state, attempts: state.attempts.map(attempt => attempt.entryId === noun.entryId
    && (attempt.exercise === 'cloze' || attempt.exercise === 'write-word') ? { ...attempt, assisted: true, independent: false } : attempt) }
  assert.equal(deriveInitialReverseProgress(noCleanWriting, bundle)[noun.entryId], undefined)
  const noCleanMeaning = { ...state, attempts: state.attempts.filter(attempt => !(attempt.entryId === noun.entryId
    && (attempt.exercise === 'choose-meaning' || attempt.exercise === 'match'))) }
  assert.equal(deriveInitialReverseProgress(noCleanMeaning, bundle)[noun.entryId], undefined)
  const introducedOnly = start(createInitialState(bundle, 'Europe/Berlin'))
  assert.deepEqual(deriveInitialReverseProgress(introducedOnly, bundle), {})
  const firstMeaning = state.attempts.find(attempt => attempt.correct && !attempt.assisted && attempt.exercise === 'choose-meaning')!
  const backdated = { ...state, attempts: [...state.attempts, { ...firstMeaning, attemptId: 'later-clock-rollback', at: '2025-01-01T12:00:00.000Z' }] }
  assert.deepEqual(deriveInitialReverseProgress(backdated, bundle), derived, 'later backdated duplicates cannot rewrite completion')
  const existing = structuredClone(state.reverseProgress)
  initializeReverseProgress(state, bundle)
  initializeReverseProgress(state, bundle)
  assert.deepEqual(state.reverseProgress, existing)
  assert.ok(Object.values(derived).every(progress => progress.completedAt === NOW && progress.correctCount === 0
    && progress.incorrectCount === 0 && progress.lastReviewedAt === null && progress.nextDueAt === TOMORROW))
})

test('seeded mixing changes positions, keeps new-word order and cannot select a future/current-batch word', () => {
  const learned = fifteen()
  const positions = new Set<string>()
  for (let seed = 1; seed <= 16; seed++) {
    const state = fourth(learned, TOMORROW, seed)
    const cards = state.session!.queue.filter(task => task.kind === 'flashcard')
    assert.equal(cards.length, 5)
    assert.deepEqual(cards.map(card => card.entryId), bundle.lessons!.find(lesson => lesson.lessonId === 'lesson-04')!.introducedEntryIds.slice(0, 5))
    positions.add(state.session!.queue.flatMap((task, index) => task.kind === 'reverse-card' ? [index] : []).join(','))
    assert.deepEqual(state.session!.queue, fourth(learned, TOMORROW, seed).session!.queue.map(task => ({ ...task,
      taskId: task.taskId.replace(/reverse-session-\d+/u, state.session!.sessionId) })))
  }
  assert.ok(positions.size > 3)
  const ids = Object.keys(learned.reverseProgress)
  for (const id of ids.slice(1)) learned.reverseProgress[id].nextDueAt = '2026-04-01T12:00:00.000Z'
  assert.deepEqual(selectReverseEntries(learned, bundle, [], TOMORROW, 5), [ids[0]])
  assert.deepEqual(selectReverseEntries(learned, bundle, [ids[0]], TOMORROW, 5), [])
  assert.deepEqual(selectReverseEntries(learned, bundle, [], NOW, 5), [])
  const cards = mixReverseCards([], [ids[0]], 'only-review', 4)
  assert.equal(cards.length, 1)
  assert.equal(cards[0].kind, 'reverse-card')
})

test('reverse reveal/rating is persisted and atomic; duplicate/stale rating or skipping has no effect', () => {
  let state = toReverse(fourth(fifteen()))
  const task = currentTask(state)!
  assert.equal(task.kind, 'reverse-card')
  const rating: LearningCommand = { type: 'rate-reverse', taskId: task.taskId, reviewId: 'fixed-rating', correct: true }
  assert.equal(apply(state, rating, TOMORROW), state, 'must reveal first')
  assert.equal(apply(state, { type: 'next', taskId: task.taskId }, TOMORROW), state)
  assert.equal(apply(state, { type: 'answer', taskId: task.taskId, attemptId: 'invalid-written', answer: task.entryId }, TOMORROW), state)
  assert.equal(apply(state, { type: 'assist', taskId: task.taskId, eventId: 'invalid-help', kind: 'answer' }, TOMORROW), state)
  const originalDirection = structuredClone({ progress: state.progress, attempts: state.attempts, assistanceEvents: state.assistanceEvents })
  state = apply(state, { type: 'reveal-card', taskId: task.taskId }, TOMORROW)
  const revealed = structuredClone(state)
  revealed.session!.state = 'paused'
  state = start(revealed, TOMORROW, 99)
  assert.deepEqual(currentTask(state), currentTask(revealed))
  assert.equal(apply(state, { type: 'reveal-card', taskId: task.taskId }, TOMORROW), state)
  const cursor = state.session!.cursor, revision = state.revision
  const scored = apply(state, rating, TOMORROW)
  assert.equal(scored.revision, revision + 1)
  assert.equal(scored.session!.cursor, cursor + 1)
  assert.equal(scored.reverseReviews.length, 1)
  assert.equal(scored.reverseProgress[task.entryId].correctCount, 1)
  assert.equal(scored.reverseProgress[task.entryId].successStreak, 1)
  assert.equal(scored.reverseProgress[task.entryId].intervalDays, 3)
  assert.deepEqual({ progress: Object.fromEntries(Object.keys(originalDirection.progress).map(id => [id, scored.progress[id]])),
    attempts: scored.attempts, assistanceEvents: scored.assistanceEvents }, originalDirection)
  assert.deepEqual(scored.progress[task.entryId], state.progress[task.entryId], 'reverse rating never changes original-direction schedule or skill counts')
  assert.equal(apply(scored, rating, TOMORROW), scored)
  assert.equal(apply(scored, { ...rating, reviewId: 'second-click' }, TOMORROW), scored)
  assert.equal(Object.keys(scored.reverseProgress).length, 15, 'reviewing old words does not add completions')
})

test('wrong self-assessment resets only reverse streak and is never repeated in the same session after resume', () => {
  let state = toReverse(fourth(fifteen()))
  const task = currentTask(state)!
  assert.equal(task.kind, 'reverse-card')
  state = perform(state, TOMORROW, false)
  assert.equal(state.reverseProgress[task.entryId].incorrectCount, 1)
  assert.equal(state.reverseProgress[task.entryId].successStreak, 0)
  assert.equal(state.reverseProgress[task.entryId].intervalDays, 1)
  assert.equal(state.reverseProgress[task.entryId].nextDueAt, '2026-03-28T12:00:00.000Z')
  const queue = structuredClone(state.session!.queue)
  state = apply(state, { type: 'pause' }, TOMORROW)
  state = start(state, '2026-03-29T12:00:00.000Z')
  assert.equal(reverseTasks(state).filter(item => item.entryId === task.entryId).length, 1)
  assert.deepEqual(reverseTasks(state), queue.filter(item => item.kind === 'reverse-card'))
  assert.ok(!state.session!.queue.slice(state.session!.cursor).some(item => item.kind === 'reverse-card' && item.entryId === task.entryId))
})

test('archived unfinished reverse cards reserve their words across lesson switches', () => {
  let state = fourth(fifteen())
  const reserved = reverseTasks(state).map(task => task.entryId)
  state = apply(state, { type: 'select-lesson', lessonId: bundle.lesson.lessonId }, TOMORROW)
  state = start(state, TOMORROW)
  assert.ok(reverseTasks(state).every(task => !reserved.includes(task.entryId)))
  state = apply(state, { type: 'select-lesson', lessonId: 'lesson-04' }, TOMORROW)
  assert.deepEqual(reverseTasks(state).map(task => task.entryId), reserved)
})

test('weighted eligibility prefers overdue/error/earlier-lesson candidates statistically without deterministic repetition', () => {
  const state = fifteen()
  const ids = Object.keys(state.reverseProgress)
  const favored = ids[0]
  state.reverseProgress[favored].nextDueAt = '2026-03-01T12:00:00.000Z'
  state.reverseProgress[favored].incorrectCount = 5
  const selected = new Set<string>()
  let favoredCount = 0
  for (let seed = 0; seed < 100; seed++) {
    const sample = selectReverseEntries(state, bundle, [], TOMORROW, seed)
    if (sample.includes(favored)) favoredCount++
    for (const id of sample) selected.add(id)
  }
  assert.ok(favoredCount > 65)
  assert.ok(selected.size > 5)
})

test('reverse-only sessions remain available after all new vocabulary is exhausted', () => {
  let state = fifteen()
  state = finish(start(state))
  assert.equal(Object.keys(state.reverseProgress).length, 20)
  state = start(state, TOMORROW)
  assert.equal(state.session!.queue.filter(task => task.kind === 'flashcard').length, 0)
  assert.equal(reverseTasks(state).length, 2)
  const complete = finish(state, TOMORROW)
  assert.equal(complete.session!.state, 'ended')
  assert.equal(complete.reverseReviews.length, 2)
})

test('calendar review intervals preserve local wall time across DST and dates, including nonexistent spring wall time', () => {
  assert.equal(calendarDaysAfter('2026-03-28T11:00:00.000Z', 1, 'Europe/Berlin'), '2026-03-29T10:00:00.000Z')
  assert.equal(calendarDaysAfter('2026-10-24T10:00:00.000Z', 1, 'Europe/Berlin'), '2026-10-25T11:00:00.000Z')
  assert.equal(calendarDaysAfter('2026-03-28T01:30:00.000Z', 1, 'Europe/Berlin'), '2026-03-29T01:30:00.000Z')
  assert.equal(calendarDaysAfter('2026-12-31T20:10:00.123Z', 1, 'Asia/Tehran'), '2027-01-01T20:10:00.123Z')
  assert.equal(reverseStudyDate('2026-12-31T22:00:00.000Z', 'Asia/Tehran'), '2027-01-01')
  const progress = Object.values(fifteen().reverseProgress)[0]
  let now = TOMORROW
  for (const days of [3, 7, 14, 30, 60, 90]) {
    scheduleReverseReview(progress, true, now, 'Europe/Berlin')
    assert.equal(progress.intervalDays, days)
    assert.equal(progress.nextDueAt, calendarDaysAfter(now, days, 'Europe/Berlin'))
    now = progress.nextDueAt
  }
  for (let count = 0; count < 20; count++) { scheduleReverseReview(progress, true, now, 'Europe/Berlin'); now = progress.nextDueAt }
  assert.equal(progress.intervalDays, REVERSE_MAX_INTERVAL_DAYS)
  const correctCount = progress.correctCount
  scheduleReverseReview(progress, false, now, 'Europe/Berlin')
  assert.equal(progress.successStreak, 0)
  assert.equal(progress.intervalDays, 1)
  assert.equal(progress.correctCount, correctCount)
  assert.equal(progress.incorrectCount, 1)
})
