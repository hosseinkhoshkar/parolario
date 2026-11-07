import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AppState, ContentBundle, Entry, LearningCommand, SessionTask } from '../contracts/index.ts'
import { createInitialState, currentTask, getEntryStatus, getHomeStats, normalizeAnswer, summarizeSession, transition } from './engine.ts'

const NOW = '2026-01-01T12:00:00.000Z'
const bundle: ContentBundle = {
  contentVersion: 'test-v1', sources: [], sourceRefs: [],
  lesson: { lessonId: 'lesson-1', titleIt: 'Lektion', titleFa: 'درس', level: 'A1', coverage: 'partial', introducedEntryIds: [] },
  provenance: { file: 'test', reviewStatus: 'excerpt-checked', noteFa: 'fixture' },
  entries: Array.from({ length: 8 }, (_, index): Entry => ({
    entryId: `word-${index}`, introducedInLessonId: 'lesson-1', introductionOrder: index,
    lemma: `Wort${index}`, meaningFa: `معنی ${index}`, partOfSpeech: 'other' as const,
    sourceRefIds: [], occurrences: [], examples: [],
    cloze: { sentence: 'Das ist ___.', translationFa: 'این است', acceptedAnswers: [`Wort${index}`], exampleId: `ex${index}` },
    writing: { promptFa: `معنی ${index}`, cueFa: 'واژه', acceptedAnswers: [`Wort${index}`], caseSensitive: false },
    meaningOptionEntryIds: [0, 1, 2, 3].map(n => `word-${(index + n) % 8}`),
    enabledExercises: ['flashcard', 'choose-meaning', 'cloze', 'match', 'write-word'], reviewStatus: 'excerpt-checked',
  })),
}
bundle.lesson.introducedEntryIds = bundle.entries.map(entry => entry.entryId)

function initial(): AppState { return createInitialState(bundle, 'Europe/Berlin') }
let sequence = 0
function apply(state: AppState, command: LearningCommand, now = NOW): AppState {
  return transition(state, command, bundle, now)
}
function start(state: AppState, now = NOW): AppState {
  return apply(state, { type: 'start-session', sessionId: `session-${++sequence}`, seed: 731 }, now)
}
function next(state: AppState, now = NOW): AppState {
  return apply(state, { type: 'next', taskId: currentTask(state)!.taskId }, now)
}
function written(task: SessionTask): task is Extract<SessionTask, { kind: 'cloze' | 'write-word' }> {
  return task.kind === 'cloze' || task.kind === 'write-word'
}
function answer(state: AppState, correct = true, now = NOW): AppState {
  const task = currentTask(state)!
  assert.notEqual(task.kind, 'flashcard')
  if (task.kind === 'flashcard' || task.kind === 'reverse-card') throw new Error('unreachable')
  const entryId = task.kind === 'match'
    ? task.entryIds.find(id => !task.matchedEntryIds.includes(id))! : task.entryId
  return apply(state, { type: 'answer', taskId: task.taskId, attemptId: `attempt-${++sequence}`, entryId,
    answer: correct ? written(task) ? bundle.entries.find(entry => entry.entryId === entryId)!.writing.acceptedAnswers[0]
      : task.kind === 'choose-article' ? bundle.entries.find(entry => entry.entryId === entryId)!.nounData!.article : entryId
      : written(task) ? 'wrong' : task.kind === 'match' ? task.entryIds.find(id => id !== entryId && !task.matchedEntryIds.includes(id))!
        : task.kind === 'choose-article' ? task.options.find(option => option !== bundle.entries.find(entry => entry.entryId === entryId)!.nounData!.article)!
          : task.optionIds.find(id => id !== entryId)!,
  }, now)
}
function performCurrent(state: AppState, now = NOW): AppState {
  const task = currentTask(state)!
  if (task.kind === 'flashcard') {
    state = apply(state, { type: 'reveal-card', taskId: task.taskId }, now)
  } else state = answer(state, true, now)
  return next(state, now)
}
function until(state: AppState, predicate: (task: SessionTask) => boolean, now = NOW): AppState {
  for (let step = 0; step < 200; step++) {
    const task = currentTask(state)
    assert.ok(task, 'expected another task')
    if (predicate(task)) return state
    state = performCurrent(state, now)
  }
  throw new Error('task not reached')
}
function finish(state: AppState, now = NOW): AppState {
  for (let step = 0; currentTask(state) && step < 200; step++) state = performCurrent(state, now)
  assert.equal(state.session?.state, 'ended')
  return state
}

test('a session introduces at most five actual cards and preserves stable entry identity', () => {
  let state = start(initial())
  assert.equal(Object.keys(state.progress).length, 1, 'queued cards are not yet introductions')
  assert.equal(state.session!.introducedEntryIds.length, 1)
  state = finish(state)
  assert.equal(Object.keys(state.progress).length, 5)
  assert.equal(state.session!.introducedEntryIds.length, 5)
  assert.equal(summarizeSession(state, NOW).introduced, 5)
  assert.equal(getHomeStats(state, bundle, NOW).introduced, 5)
  state = finish(start(state))
  assert.equal(Object.keys(state.progress).length, 8)
  assert.equal(state.session!.introducedEntryIds.length, 3)
  state = start(state)
  assert.equal(currentTask(state), null, 'no endless game when nothing is due or new')
})

test('card revelation and meaning recognition never create a successful recall or mastery', () => {
  let state = start(initial())
  const id = 'word-0'
  assert.equal(state.progress[id].nextDueAt, null)
  const task = currentTask(state)!
  state = apply(state, { type: 'reveal-card', taskId: task.taskId })
  assert.equal(state.attempts.length, 0)
  assert.equal(state.progress[id].nextDueAt, null)
  state = next(state)
  state = until(state, task => task.kind === 'choose-meaning' && task.entryId === id)
  state = answer(state)
  assert.equal(state.progress[id].nextDueAt, null)
  assert.equal(state.progress[id].initialRecallPending, true)
  assert.equal(state.attempts[0].independent, false)
})

test('independent initial recall then separate-day scheduled intervals are 1,3,7,14,30,30', () => {
  let state = until(start(initial()), task => task.kind === 'cloze')
  state = answer(state)
  let now = state.progress['word-0'].nextDueAt!
  assert.equal(now, '2026-01-02T12:00:00.000Z')
  state = apply(state, { type: 'end-session' })
  for (const interval of [3, 7, 14, 30, 30]) {
    state = start(state, now)
    const task = currentTask(state)!
    assert.ok(written(task))
    assert.equal(task.cycleKind, 'scheduled')
    state = answer(state, true, now)
    assert.equal(Date.parse(state.progress['word-0'].nextDueAt!) - Date.parse(now), interval * 86_400_000)
    state = apply(state, { type: 'end-session' }, now)
    now = state.progress['word-0'].nextDueAt!
  }
  assert.equal(state.progress['word-0'].scheduledReviewDates.length, 5)
})

test('same-study-date scheduled correctness and early recall do not advance a step', () => {
  let state = until(start(initial()), task => task.kind === 'cloze')
  state = answer(state)
  state = apply(state, { type: 'end-session' })
  const due = state.progress['word-0'].nextDueAt!
  state = start(state, due)
  state.progress['word-0'].lastSuccessDate = '2026-01-02'
  const before = structuredClone(state.progress['word-0'])
  state = answer(state, true, due)
  assert.equal(state.progress['word-0'].intervalIndex, before.intervalIndex)
  assert.equal(state.progress['word-0'].nextDueAt, before.nextDueAt)
  assert.equal(state.progress['word-0'].scheduledReviewDates.length, 0)
})

test('DST fallback same-date due success does not loop or block the next new card', () => {
  // Europe/Berlin has a 25-hour date on 2026-10-25: +24h is still that study date.
  const introducedAt = '2026-10-24T22:30:00.000Z'
  let state = until(start(initial(), introducedAt), task => task.kind === 'cloze', introducedAt)
  state = answer(state, true, introducedAt)
  const dueAt = state.progress['word-0'].nextDueAt!
  assert.equal(dueAt, '2026-10-25T22:30:00.000Z')
  state = apply(state, { type: 'end-session' }, introducedAt)
  state = start(state, dueAt)
  const reviewSessionId = state.session!.sessionId
  const review = currentTask(state)!
  assert.ok(written(review))
  assert.equal(review.cycleKind, 'scheduled')
  state = answer(state, true, dueAt)
  assert.equal(state.progress['word-0'].nextDueAt, dueAt)
  assert.equal(state.progress['word-0'].intervalIndex, 0)
  assert.deepEqual(state.progress['word-0'].scheduledReviewDates, [])
  state = next(state, dueAt)
  state = until(state, task => task.kind === 'flashcard', dueAt)
  assert.equal(currentTask(state)!.kind, 'flashcard', 'after unfinished reviews, a new card is reachable')
  state = apply(state, { type: 'pause' }, dueAt)
  state = start(structuredClone(state), dueAt)
  state = finish(state, dueAt)
  assert.equal(state.attempts.filter(attempt => attempt.sessionId === reviewSessionId
    && attempt.entryId === 'word-0' && attempt.independent && attempt.correct).length, 1)
  assert.equal(state.progress['word-0'].nextDueAt, dueAt, 'same-day success does not move the due time')
  assert.equal(state.progress['word-0'].intervalIndex, 0)
})

test('resuming batch practice on a later day reinserts due recall and preserves the current draft', () => {
  let state = until(start(initial()), task => task.kind === 'cloze')
  state = answer(state)
  state = next(state)
  state = until(state, task => task.kind === 'cloze' && task.entryId === 'word-1')
  const currentTaskId = currentTask(state)!.taskId
  const sessionId = state.session!.sessionId
  state = apply(state, { type: 'draft', taskId: currentTaskId, value: 'Wor' })
  state = apply(state, { type: 'pause' })
  const later = '2026-01-03T12:00:00.000Z'
  state = start(structuredClone(state), later)
  assert.equal(state.session!.sessionId, sessionId)
  assert.equal(currentTask(state)!.taskId, currentTaskId)
  assert.equal(state.session!.draft, 'Wor')
  const remaining = state.session!.queue.slice(state.session!.cursor)
  const dueIndex = remaining.findIndex(task => written(task) && task.entryId === 'word-0')
  assert.ok(dueIndex > 0, 'newly due recall is queued after the preserved prompt')
  assert.ok(!remaining.some(task => task.kind === 'flashcard'), 'already introduced cards are not reopened')
  state = answer(state, true, later)
  state = next(state, later)
  state = until(state, task => written(task) && task.entryId === 'word-0', later)
  const dueTask = currentTask(state)!
  assert.ok(written(dueTask))
  assert.equal(dueTask.entryId, 'word-0')
  state = answer(state, true, later)
  assert.equal(state.progress['word-0'].intervalIndex, 1)
  assert.equal(state.progress['word-0'].nextDueAt, '2026-01-06T12:00:00.000Z')
  state = next(state, later)
  assert.ok(!currentTask(state) || currentTask(state)!.kind !== 'flashcard')
})

test('due recall precedes unfinished work and new cards, without showing the answer card', () => {
  let state = finish(start(initial()))
  state.progress['word-2'].nextDueAt = NOW
  state.progress['word-3'].initialRecallPending = true
  state = start(state)
  const task = currentTask(state)!
  assert.ok(written(task))
  assert.equal(task.entryId, 'word-2')
  const ids = state.session!.queue.filter(task => task.kind !== 'match').map(task => task.entryId)
  assert.ok(ids.indexOf('word-2') < ids.indexOf('word-3'))
  assert.equal(new Set(state.session!.queue.map(task => task.taskId)).size, state.session!.queue.length)
})

test('wrong recognition removes the immediate cloze and retries only after three other answers', () => {
  let state = until(start(initial()), task => task.kind === 'choose-meaning')
  state = answer(state, false)
  assert.equal(state.progress['word-0'].pendingError!.remainingOtherAnswers, 3)
  assert.equal(state.progress['word-0'].nextDueAt, NOW)
  assert.ok(state.session!.feedback!.explanationFa.includes('معنی 0'))
  state = next(state)
  assert.notEqual(currentTask(state)?.kind, 'cloze')
  let others = 0
  for (let index = 0; index < 40; index++) {
    const task = currentTask(state)!
    if (written(task) && task.entryId === 'word-0') break
    if (task.kind !== 'flashcard' && task.kind !== 'match' && task.entryId !== 'word-0') others++
    state = performCurrent(state)
    if (others < 3) assert.notEqual(currentTask(state)?.kind === 'cloze' && (currentTask(state) as { entryId: string }).entryId, 'word-0')
  }
  assert.ok(others >= 3)
  const retry = currentTask(state)!
  assert.ok(written(retry))
  assert.equal(retry.cycleKind, 'recovery')
  state = answer(state)
  assert.equal(state.progress['word-0'].pendingError, null)
  assert.equal(state.progress['word-0'].nextDueAt, '2026-01-02T12:00:00.000Z')
  assert.equal(state.progress['word-0'].scheduledReviewDates.length, 0)
})

test('pause/resume preserves draft, current task, feedback and error spacing', () => {
  let state = until(start(initial()), task => task.kind === 'cloze')
  const taskId = currentTask(state)!.taskId
  state = apply(state, { type: 'draft', taskId, value: 'Wor' })
  state = apply(state, { type: 'pause' })
  state = start(structuredClone(state), '2026-01-02T12:00:00.000Z')
  assert.equal(currentTask(state)!.taskId, taskId)
  assert.equal(state.session!.draft, 'Wor')
  state = answer(state, false)
  const feedback = state.session!.feedback
  state = apply(state, { type: 'pause' })
  state = start(structuredClone(state))
  assert.deepEqual(state.session!.feedback, feedback)
  assert.equal(state.progress['word-0'].pendingError!.remainingOtherAnswers, 3)
})

test('duplicate attempt ID, stale next and repeated reveal have no effect', () => {
  let state = until(start(initial()), task => task.kind === 'choose-meaning')
  const command: LearningCommand = { type: 'answer', taskId: currentTask(state)!.taskId, attemptId: 'fixed', answer: 'word-0' }
  state = apply(state, command)
  assert.equal(apply(state, command), state)
  const oldTaskId = currentTask(state)!.taskId
  state = next(state)
  assert.equal(apply(state, { type: 'next', taskId: oldTaskId }), state)
  assert.equal(state.attempts.filter(attempt => attempt.attemptId === 'fixed').length, 1)
})

test('four-pair game checks actual identity; wrong pair is not credited and matched pair cannot count twice', () => {
  let state = until(start(initial()), task => task.kind === 'match')
  let task = currentTask(state)!
  assert.equal(task.kind, 'match')
  if (task.kind !== 'match') throw new Error('unreachable')
  assert.equal(task.entryIds.length, 4)
  assert.notDeepEqual(task.leftOrder, task.rightOrder)
  const [left, other] = task.entryIds
  state = apply(state, { type: 'answer', taskId: task.taskId, attemptId: 'wrong-pair', entryId: left, answer: other })
  assert.equal(state.attempts.at(-1)!.correct, false)
  assert.deepEqual((currentTask(state) as Extract<SessionTask, { kind: 'match' }>).matchedEntryIds, [])
  state = next(state)
  task = currentTask(state)!
  state = apply(state, { type: 'answer', taskId: task.taskId, attemptId: 'correct-pair', entryId: left, answer: left })
  assert.equal(state.attempts.at(-1)!.correct, true)
  assert.equal(state.attempts.at(-1)!.independent, false)
  state = next(state)
  assert.equal(apply(state, { type: 'answer', taskId: task.taskId, attemptId: 'duplicate-pair', entryId: left, answer: left }), state)
  state = finish(state)
  assert.equal(state.attempts.filter(attempt => attempt.exercise === 'match' && attempt.correct).length, 4)
  assert.equal(state.progress[left].pendingError, null, 'a later error still gets independent recovery in the same session')
  assert.equal(state.attempts.filter(attempt => attempt.entryId === left && attempt.independent && attempt.correct).length, 3)
})

test('when insufficient other answers remain the error persists for the next session', () => {
  let state = finish(start(initial()))
  // All words except one are far in the future; disable new words for this fixture.
  const smallBundle = { ...bundle, entries: bundle.entries.slice(0, 5) }
  state.progress['word-0'].nextDueAt = NOW
  state = transition(state, { type: 'start-session', sessionId: 'only-review', seed: 1 }, smallBundle, NOW)
  state = transition(state, { type: 'answer', taskId: currentTask(state)!.taskId, attemptId: 'last-wrong', answer: 'wrong' }, smallBundle, NOW)
  // Explicit end preserves the unresolved error even if matching is available.
  state = transition(state, { type: 'end-session' }, smallBundle, NOW)
  assert.equal(getEntryStatus(state, 'word-0', NOW), 'due')
  state = transition(state, { type: 'start-session', sessionId: 'next-review', seed: 1 }, smallBundle, NOW)
  const recovery = currentTask(state)!
  assert.ok(written(recovery))
  assert.equal(recovery.cycleKind, 'recovery')
})

test('normalization accepts whitespace and NFC while preserving case, umlauts and ß', () => {
  assert.equal(normalizeAnswer('  Guten   Tag  '), 'Guten Tag')
  assert.equal(normalizeAnswer('Gru\u0308ße'), 'Grüße')
  assert.notEqual(normalizeAnswer('gruße'), normalizeAnswer('Grüße'))
  assert.notEqual(normalizeAnswer('Strasse'), normalizeAnswer('Straße'))
})

test('a fresh batch presents every new card before practice and resumes its saved card after reload', () => {
  let state = start(initial())
  const firstFive = state.session!.queue.slice(0, 5)
  assert.ok(firstFive.every(task => task.kind === 'flashcard'))
  assert.equal(new Set(firstFive.map(task => 'entryId' in task && task.entryId)).size, 5)
  for (let index = 0; index < 5; index++) {
    const card = currentTask(state)!
    assert.equal(card.kind, 'flashcard')
    assert.equal(state.session!.introducedEntryIds.length, index + 1)
    assert.equal(state.attempts.length, 0, 'no new-word exercises before the whole card batch')
    state = apply(state, { type: 'reveal-card', taskId: card.taskId })
    if (index === 2) {
      state = apply(state, { type: 'pause' })
      const saved = structuredClone(state.session!)
      state = start(JSON.parse(JSON.stringify(state)))
      assert.equal(state.session!.sessionId, saved.sessionId)
      assert.equal(state.session!.cursor, saved.cursor)
      assert.deepEqual(state.session!.queue, saved.queue)
      const resumedCard = currentTask(state)!
      assert.equal(resumedCard.kind === 'flashcard' && resumedCard.revealed, true)
    }
    state = next(state)
  }
  assert.equal(currentTask(state)!.kind, 'choose-meaning')
  assert.equal(state.session!.introducedEntryIds.length, 5)
  assert.ok(!state.session!.queue.slice(state.session!.cursor).some(task => task.kind === 'flashcard'))
  state = finish(state)
  assert.deepEqual(new Set(state.attempts.map(attempt => attempt.entryId)), new Set(firstFive.map(task => 'entryId' in task && task.entryId)))
})

test('an existing interleaved session retains its queue, revealed card and cursor on resume', () => {
  let state = start(initial())
  // Simulate a schema-3 session created before batched cards were introduced.
  const tasks = state.session!.queue
  const cards = tasks.filter(task => task.kind === 'flashcard')
  state.session!.queue = cards.flatMap(card => [card, ...tasks.filter(task => task.kind !== 'flashcard' && task.kind !== 'match' && task.entryId === card.entryId)])
  state.session!.queue.push(...tasks.filter(task => task.kind === 'match'))
  state = apply(state, { type: 'reveal-card', taskId: currentTask(state)!.taskId })
  state = apply(state, { type: 'pause' })
  const saved = structuredClone(state.session!)
  state = start(JSON.parse(JSON.stringify(state)))
  assert.deepEqual(state.session!.queue, saved.queue)
  assert.equal(state.session!.cursor, saved.cursor)
  state = next(state)
  assert.equal(currentTask(state)!.kind, 'choose-meaning')
  state = finish(state)
  assert.equal(state.session!.introducedEntryIds.length, 5)
})
