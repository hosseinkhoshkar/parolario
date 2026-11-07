import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lessonOneBundle } from '../testing/legacy-fixture.ts'
import type { AppState, ContentBundle, Entry, LearningCommand, SessionTask } from '../contracts/index.ts'
import { createInitialState, currentTask, getEntryStatus, getHomeStats, summarizeSession, transition } from './engine.ts'

const NOW = '2026-10-28T12:00:00.000Z'
let sequence = 0
function command(state: AppState, value: LearningCommand, now = NOW, bundle = lessonOneBundle) {
  return transition(state, value, bundle, now)
}
function start(bundle = lessonOneBundle, now = NOW) {
  return command(createInitialState(bundle, 'Europe/Berlin'), { type: 'start-session', sessionId: `phase2-${++sequence}`, seed: 32 }, now, bundle)
}
function expected(task: Exclude<SessionTask, { kind: 'flashcard' }>, bundle = lessonOneBundle) {
  const id = task.kind === 'match' ? task.entryIds.find(item => !task.matchedEntryIds.includes(item))! : task.entryId
  const entry = bundle.entries.find(item => item.entryId === id)!
  return { entryId: id, answer: task.kind === 'cloze' ? entry.cloze.acceptedAnswers[0]
    : task.kind === 'write-word' ? entry.writing.acceptedAnswers[0]
      : task.kind === 'choose-article' ? entry.nounData!.article : id }
}
function answer(state: AppState, raw?: string, now = NOW, bundle = lessonOneBundle) {
  const task = currentTask(state)!
  if (task.kind === 'flashcard') throw new Error('question expected')
  return command(state, { type: 'answer', taskId: task.taskId, attemptId: `phase2-answer-${++sequence}`,
    ...expected(task, bundle), ...(raw === undefined ? {} : { answer: raw }) }, now, bundle)
}
function next(state: AppState, now = NOW, bundle = lessonOneBundle) {
  return command(state, { type: 'next', taskId: currentTask(state)!.taskId }, now, bundle)
}
function step(state: AppState, now = NOW, bundle = lessonOneBundle) {
  const task = currentTask(state)!
  state = task.kind === 'flashcard' ? command(state, { type: 'reveal-card', taskId: task.taskId }, now, bundle) : answer(state, undefined, now, bundle)
  return next(state, now, bundle)
}
function reach(state: AppState, predicate: (task: SessionTask) => boolean, now = NOW, bundle = lessonOneBundle) {
  for (let count = 0; count < 250; count++) {
    const task = currentTask(state)
    assert.ok(task)
    if (predicate(task)) return state
    state = step(state, now, bundle)
  }
  throw new Error('task not reached')
}
function prioritized(entry: Entry): ContentBundle {
  return { ...lessonOneBundle, entries: [entry, ...lessonOneBundle.entries.filter(item => item.entryId !== entry.entryId)]
    .map((item, index) => ({ ...item, introductionOrder: index })) }
}
function writeState(entry: Entry) {
  const bundle = prioritized(entry)
  const state = reach(start(bundle), task => task.kind === 'write-word' && task.entryId === entry.entryId, NOW, bundle)
  return { state, bundle }
}

test('seed varies written-question order deterministically while keeping the card/meaning and article boundaries', () => {
  const noun = lessonOneBundle.entries.find(entry => entry.nounData)!
  const bundle = prioritized(noun)
  const build = (seed: number) => command(createInitialState(bundle, 'Europe/Berlin'),
    { type: 'start-session', sessionId: 'seed-order', seed }, NOW, bundle)
  const even = build(8).session!.queue.filter(task => 'entryId' in task && task.entryId === noun.entryId).map(task => task.kind)
  const odd = build(9).session!.queue.filter(task => 'entryId' in task && task.entryId === noun.entryId).map(task => task.kind)
  assert.deepEqual(even, ['flashcard', 'choose-meaning', 'cloze', 'write-word', 'choose-article'])
  assert.deepEqual(odd, ['flashcard', 'choose-meaning', 'write-word', 'cloze', 'choose-article'])
  assert.deepEqual(build(9).session!.queue, build(9).session!.queue)
})

test('typed answers use NFC/whitespace, entry case rules and explicit variants with canonical feedback', () => {
  const bye = lessonOneBundle.entries.find(entry => entry.lemma === 'Tschüss')!
  for (const value of ['  Tschu\u0308ss  ', 'tschuess']) {
    const { state, bundle } = writeState(bye)
    const result = answer(state, value, NOW, bundle)
    assert.equal(result.session!.feedback!.correct, true)
    assert.equal(result.session!.feedback!.expectedAnswer, 'Tschüss')
    assert.equal(result.attempts.at(-1)!.answer, value, 'raw spelling is preserved')
    assert.equal(result.progress[bye.entryId].skills.writing.lastAttemptAt, NOW)
  }
  for (const value of ['Tschuss', 'Tschüss!', 'Tschü', 'Tschuesss']) {
    const { state, bundle } = writeState(bye)
    assert.equal(answer(state, value, NOW, bundle).session!.feedback!.correct, false)
  }
  const name = lessonOneBundle.entries.find(entry => entry.lemma === 'heißen')!
  const { state, bundle } = writeState(name)
  assert.equal(answer(state, 'heissen', NOW, bundle).session!.feedback!.correct, true)
  assert.equal(answer(state, 'heißt', NOW, bundle).session!.feedback!.correct, false, 'no stemming or inferred inflections')
})

test('case-sensitive semantic counterpart is not silently normalized (Sie/sie)', () => {
  const base = lessonOneBundle.entries[0]
  for (const canonical of ['Sie', 'sie']) {
    const entry = { ...base, lemma: canonical, writing: { ...base.writing, acceptedAnswers: [canonical], caseSensitive: true } }
    const { state, bundle } = writeState(entry)
    const wrongCase = canonical === 'Sie' ? 'sie' : 'Sie'
    assert.equal(answer(state, wrongCase, NOW, bundle).session!.feedback!.correct, false)
    assert.equal(answer(state, canonical, NOW, bundle).session!.feedback!.correct, true)
  }
})

test('article questions exist only for nouns, score article skill and cannot boost the schedule', () => {
  const noun = lessonOneBundle.entries.find(entry => entry.nounData)!
  const bundle = prioritized(noun)
  let state = reach(start(bundle), task => task.kind === 'choose-article', NOW, bundle)
  const before = structuredClone(state.progress[noun.entryId])
  const task = currentTask(state)!
  assert.equal(task.kind, 'choose-article')
  state = answer(state, undefined, NOW, bundle)
  assert.equal(state.progress[noun.entryId].skills.article!.unassistedCorrect, 1)
  assert.equal(state.progress[noun.entryId].skills.meaning.correct, before.skills.meaning.correct)
  assert.equal(state.progress[noun.entryId].skills.writing.correct, before.skills.writing.correct)
  assert.equal(state.progress[noun.entryId].nextDueAt, before.nextDueAt)
  assert.equal(state.progress[noun.entryId].intervalIndex, before.intervalIndex)
  assert.equal(state.attempts.at(-1)!.independent, false)
  for (const queued of state.session!.queue.filter(item => item.kind === 'choose-article')) {
    assert.equal(bundle.entries.find(entry => entry.entryId === queued.entryId)!.partOfSpeech, 'noun')
  }
  const verb = lessonOneBundle.entries.find(entry => entry.partOfSpeech === 'verb')!
  const verbState = start(prioritized(verb))
  assert.equal(verbState.progress[verb.entryId].skills.article, null)
  assert.ok(!verbState.session!.queue.some(item => item.kind === 'choose-article' && item.entryId === verb.entryId))
})

test('persisted help is idempotent, makes following correctness assisted, and does not fabricate a wrong answer', () => {
  let state = reach(start(), task => task.kind === 'cloze')
  const task = currentTask(state)!
  assert.equal(task.kind, 'cloze')
  const id = task.entryId
  const cleanBeforeHelp = state.progress[id].skills.writing.unassistedCorrect
  const assist: LearningCommand = { type: 'assist', taskId: task.taskId, eventId: 'help-id', kind: 'hint' }
  const beforeAnswers = state.attempts.length
  state = command(state, assist)
  assert.equal(state.attempts.length, beforeAnswers)
  assert.equal(state.progress[id].wrongCount, 0)
  assert.equal(state.progress[id].pendingError!.reason, 'assisted')
  assert.equal(command(state, assist), state)
  state = command(state, { type: 'pause' })
  state = command(structuredClone(state), { type: 'start-session', sessionId: 'ignored-on-resume', seed: 6 })
  assert.equal(currentTask(state)!.assisted, true)
  state = command(state, { type: 'assist', taskId: task.taskId, eventId: 'second-help-id', kind: 'answer' })
  state = answer(state)
  assert.equal(state.session!.feedback!.assisted, true)
  assert.equal(state.attempts.at(-1)!.independent, false)
  assert.equal(state.progress[id].skills.writing.assisted, 1)
  assert.equal(state.progress[id].skills.writing.unassistedCorrect, cleanBeforeHelp)
  assert.equal(state.progress[id].pendingError!.remainingOtherAnswers, 3)
  state = next(state)
  let otherAnswers = 0
  for (let count = 0; count < 80; count++) {
    const current = currentTask(state)!
    if ((current.kind === 'cloze' || current.kind === 'write-word') && current.entryId === id) break
    if (current.kind !== 'flashcard' && current.kind !== 'match' && current.entryId !== id) otherAnswers++
    state = step(state)
  }
  assert.ok(otherAnswers >= 3)
  assert.equal(currentTask(state)!.assisted, undefined, 'recovery is a fresh unassisted prompt')
  state = answer(state)
  assert.equal(state.progress[id].pendingError, null)
  assert.equal(state.progress[id].nextDueAt, '2026-10-29T12:00:00.000Z')
})

test('guessing the same matching pair again is assisted rather than clean meaning evidence', () => {
  let state = reach(start(), task => task.kind === 'match')
  const task = currentTask(state)!
  assert.equal(task.kind, 'match')
  const [id, other] = task.entryIds
  const before = state.progress[id].skills.meaning.unassistedCorrect
  state = command(state, { type: 'answer', taskId: task.taskId, attemptId: 'match-wrong', entryId: id, answer: other })
  state = next(state)
  state = command(state, { type: 'answer', taskId: task.taskId, attemptId: 'match-guess', entryId: id, answer: id })
  assert.equal(state.attempts.at(-1)!.assisted, true)
  assert.equal(state.progress[id].skills.meaning.unassistedCorrect, before)
  assert.equal(state.progress[id].skills.meaning.assisted, 1)
})

test('help for a paused prompt persists without resuming activity and later correctness stays assisted', () => {
  let state = reach(start(), task => task.kind === 'cloze')
  const task = currentTask(state)!
  assert.equal(task.kind, 'cloze')
  const id = task.entryId
  const beforeAnswers = state.attempts.length
  const cleanBeforeHelp = state.progress[id].skills.writing.unassistedCorrect
  state = command(state, { type: 'pause' })
  const help: LearningCommand = { type: 'assist', taskId: task.taskId, eventId: 'paused-reference', kind: 'answer' }
  state = command(state, help)
  assert.equal(state.session!.state, 'paused')
  assert.equal(state.session!.activeMs, 0)
  assert.deepEqual(state.dailyActivity, {})
  assert.equal(state.attempts.length, beforeAnswers, 'viewing the reference creates no wrong attempt')
  assert.equal(state.progress[id].wrongCount, 0)
  assert.equal(state.progress[id].pendingError!.reason, 'assisted')
  assert.equal(currentTask(state)!.assisted, true)
  assert.equal(command(state, help), state, 'the persisted assistance event is idempotent')
  assert.equal(answer(state), state, 'paused help does not enable answering')
  state = command(structuredClone(state), { type: 'start-session', sessionId: 'resume-reference', seed: 6 })
  state = answer(state)
  assert.equal(state.attempts.at(-1)!.assisted, true)
  assert.equal(state.attempts.at(-1)!.independent, false)
  assert.equal(state.progress[id].skills.writing.unassistedCorrect, cleanBeforeHelp)
  assert.equal(state.progress[id].nextDueAt, NOW, 'assisted correctness cannot advance the review')
  assert.equal(state.session!.activeMs, 0)
})

test('reference lookup can mark every unmatched game word even during another pair’s feedback', () => {
  let state = reach(start(), task => task.kind === 'match')
  const task = currentTask(state)!
  assert.equal(task.kind, 'match')
  const [alreadyMatched, ...exposed] = task.entryIds
  state = command(state, { type: 'answer', taskId: task.taskId, attemptId: 'before-reference', entryId: alreadyMatched, answer: alreadyMatched })
  const before = new Map(exposed.map(id => [id, state.progress[id].skills.meaning.unassistedCorrect]))
  const invalid = command(state, { type: 'assist', taskId: task.taskId, eventId: 'invalid-reference', kind: 'answer', entryId: 'unknown-entry' })
  assert.equal(invalid, state)
  for (const entryId of exposed) {
    state = command(state, { type: 'assist', taskId: task.taskId, eventId: `reference-${entryId}`, kind: 'answer', entryId })
    assert.equal(state.progress[entryId].pendingError!.reason, 'assisted')
    assert.equal(state.progress[entryId].wrongCount, 0)
  }
  assert.equal(state.assistanceEvents.length, exposed.length)
  state = next(state)
  for (const entryId of exposed) {
    state = command(state, { type: 'answer', taskId: task.taskId, attemptId: `after-reference-${entryId}`, entryId, answer: entryId })
    assert.equal(state.attempts.at(-1)!.assisted, true)
    assert.equal(state.attempts.at(-1)!.independent, false)
    assert.equal(state.progress[entryId].skills.meaning.unassistedCorrect, before.get(entryId))
    state = next(state)
  }
})

test('adaptive tasks address weak writing/article before new cards and remain bounded', () => {
  const noun = lessonOneBundle.entries.find(entry => entry.nounData)!
  const bundle = prioritized(noun)
  let state = reach(start(bundle), task => task.kind === 'write-word', NOW, bundle)
  state = answer(state, 'wrong', NOW, bundle)
  state = command(state, { type: 'end-session' }, NOW, bundle)
  state = command(state, { type: 'start-session', sessionId: 'adaptive', seed: 29 }, NOW, bundle)
  assert.equal(currentTask(state)!.kind, 'write-word', 'writing weakness selects writing recovery')
  const current = currentTask(state)!
  assert.equal('entryId' in current && current.entryId, noun.entryId)
  assert.ok(state.session!.queue.filter(item => item.taskId.includes(':adaptive-')).length <= 4)
  // A noun's wrong article selects an article task, never one for a verb.
  state = reach(start(bundle), task => task.kind === 'choose-article', NOW, bundle)
  state = answer(state, noun.nounData!.article === 'il' ? 'la' : 'il', NOW, bundle)
  state = command(state, { type: 'end-session' }, NOW, bundle)
  state = command(state, { type: 'start-session', sessionId: 'article-weak', seed: 30 }, NOW, bundle)
  const articleIndex = state.session!.queue.findIndex(task => task.kind === 'choose-article' && task.entryId === noun.entryId)
  const newIndex = state.session!.queue.findIndex(task => task.kind === 'flashcard')
  assert.ok(articleIndex > 0 && articleIndex < newIndex, 'due recovery is followed by targeted article before new words')
})

test('three independent scheduled dates stabilize only with clean noun article evidence; help clears it', () => {
  const noun = lessonOneBundle.entries.find(entry => entry.nounData)!
  const bundle = prioritized(noun)
  let state = reach(start(bundle), task => task.kind === 'cloze', NOW, bundle)
  state = answer(state, undefined, NOW, bundle)
  state = command(state, { type: 'end-session' }, NOW, bundle)
  for (let index = 0; index < 3; index++) {
    const now = state.progress[noun.entryId].nextDueAt!
    state = command(state, { type: 'start-session', sessionId: `stability-${index}`, seed: index }, now, bundle)
    state = answer(state, undefined, now, bundle)
    assert.equal(state.progress[noun.entryId].scheduledReviewDates.length, index + 1)
    if (index === 2) {
      assert.equal(getEntryStatus(state, noun.entryId, now), 'learning', 'article evidence is still absent')
      state = next(state, now, bundle)
      state = reach(state, task => task.kind === 'choose-article', now, bundle)
      state = answer(state, undefined, now, bundle)
      assert.equal(getEntryStatus(state, noun.entryId, now), 'stabilized')
      assert.equal(getHomeStats(state, bundle, now).stabilized, 1)
    }
    state = command(state, { type: 'end-session' }, now, bundle)
  }
  const now = state.progress[noun.entryId].nextDueAt!
  state = command(state, { type: 'start-session', sessionId: 'stability-help', seed: 3 }, now, bundle)
  state = reach(state, task => (task.kind === 'cloze' || task.kind === 'write-word') && task.entryId === noun.entryId, now, bundle)
  state = command(state, { type: 'assist', taskId: currentTask(state)!.taskId, eventId: 'break-chain', kind: 'answer' }, now, bundle)
  assert.equal(getEntryStatus(state, noun.entryId, now), 'due')
  assert.equal(state.progress[noun.entryId].scheduledReviewDates.length, 0)
})

test('activity samples count only active session, deduplicate, split study midnight and acknowledge target', () => {
  const from = '2026-10-28T22:59:58.000Z'
  const to = '2026-10-28T23:00:02.000Z'
  let state = start(lessonOneBundle, from)
  const sample: LearningCommand = { type: 'activity', eventId: 'midnight', sessionId: state.session!.sessionId, from, to, elapsedMs: 4_000 }
  state = command(state, sample, to)
  assert.equal(state.dailyActivity['2026-10-28'], 2_000)
  assert.equal(state.dailyActivity['2026-10-29'], 2_000)
  assert.equal(state.session!.activeMs, 4_000)
  assert.equal(summarizeSession(state, to).activeMs, 4_000)
  assert.equal(command(state, sample, to), state)
  assert.equal(command(state, { ...sample, eventId: 'long', elapsedMs: 8_000 }, to), state)
  assert.equal(command(state, { ...sample, eventId: 'wrong-session', sessionId: 'elsewhere' }, to), state)
  state = command(state, { type: 'pause' }, to)
  assert.equal(command(state, { ...sample, eventId: 'paused' }, to), state)
  state = command(state, { type: 'start-session', sessionId: 'resume', seed: 8 }, to)
  assert.equal(state.session!.activeMs, 4_000, 'absence is not inferred as active time')
  state.dailyActivity['2026-10-29'] = 1_200_000
  const queueLength = state.session!.queue.length
  state = command(state, { type: 'continue-after-target' }, to)
  assert.equal(state.session!.targetAcknowledged, true)
  assert.equal(state.session!.targetAcknowledgedDate, '2026-10-29')
  assert.equal(state.session!.queue.length, queueLength, 'the target does not create filler questions')
})

test('a daily target acknowledgement resets on next-day resume and can be acknowledged again after real activity', () => {
  let state = start()
  state.dailyActivity['2026-10-28'] = 1_200_000
  state = command(state, { type: 'continue-after-target' })
  assert.equal(state.session!.targetAcknowledgedDate, '2026-10-28')
  state = command(state, { type: 'pause' })
  const tomorrow = '2026-10-29T12:00:00.000Z'
  state = command(structuredClone(state), { type: 'start-session', sessionId: 'same-session', seed: 11 }, tomorrow)
  assert.equal(state.session!.targetAcknowledged, false)
  assert.equal(state.session!.targetAcknowledgedDate, null)
  assert.equal(command(state, { type: 'continue-after-target' }, tomorrow), state, 'yesterday does not satisfy today’s goal')
  state.dailyActivity['2026-10-29'] = 1_195_000
  const to = '2026-10-29T12:00:05.000Z'
  state = command(state, { type: 'activity', eventId: 'new-day-goal', sessionId: state.session!.sessionId,
    from: tomorrow, to, elapsedMs: 5_000 }, to)
  assert.equal(getHomeStats(state, lessonOneBundle, to).todayActiveMs, 1_200_000)
  state = command(state, { type: 'continue-after-target' }, to)
  assert.equal(state.session!.targetAcknowledged, true)
  assert.equal(state.session!.targetAcknowledgedDate, '2026-10-29')
})

test('ongoing activity crossing study midnight clears the previous day’s acknowledgement', () => {
  const from = '2026-10-28T22:59:58.000Z'
  const to = '2026-10-28T23:00:02.000Z'
  let state = start(lessonOneBundle, from)
  state.dailyActivity['2026-10-28'] = 1_200_000
  state = command(state, { type: 'continue-after-target' }, from)
  assert.equal(state.session!.targetAcknowledged, true)
  state = command(state, { type: 'activity', eventId: 'ack-midnight', sessionId: state.session!.sessionId,
    from, to, elapsedMs: 4_000 }, to)
  assert.equal(state.session!.targetAcknowledged, false)
  assert.equal(state.session!.targetAcknowledgedDate, null)
  assert.equal(state.dailyActivity['2026-10-29'], 2_000)
  assert.equal(state.dailyActivity['2026-10-28'], 1_202_000)
})
