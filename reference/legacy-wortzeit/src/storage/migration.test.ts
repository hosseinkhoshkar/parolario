import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lessonOneBundle } from '../content/lesson-one.ts'
import { courseBundle } from '../content/catalog.ts'
import type { AppState as LegacyState, Attempt as LegacyAttempt, ContentBundle as LegacyBundle } from '../contracts/legacy-v1.ts'
import { createInitialState, currentTask, transition } from '../learning/engine.ts'
import { loadState, migrateState, saveState, validateState } from './index.ts'
import { validateLegacyState } from './legacy-v1.ts'
import { indexedDBModel } from './test-idb.ts'

const NOW = '2026-10-28T12:00:00.000Z'
const legacyBundle = { ...lessonOneBundle, contentVersion: 'lesson-01-excerpt-v1' } as unknown as LegacyBundle
function legacySample(mode: 'paused' | 'ended' | 'feedback' | 'draft' | 'match' = 'paused'): LegacyState {
  let state = transition(createInitialState(lessonOneBundle, 'Europe/Berlin'), {
    type: 'start-session', sessionId: 'legacy-session', seed: 4,
  }, lessonOneBundle, NOW)
  let id = 0
  while (currentTask(state)) {
    const task = currentTask(state)!
    if (mode === 'match' && task.kind === 'match' || mode === 'draft' && task.kind === 'cloze') break
    if (task.kind === 'flashcard') state = transition(state, { type: 'reveal-card', taskId: task.taskId }, lessonOneBundle, NOW)
    else {
      const entryId = task.kind === 'match' ? task.entryIds.find(item => !task.matchedEntryIds.includes(item))! : task.entryId
      const entry = lessonOneBundle.entries.find(item => item.entryId === entryId)!
      state = transition(state, { type: 'answer', taskId: task.taskId, attemptId: `legacy-attempt-${id++}`, entryId,
        answer: task.kind === 'cloze' ? entry.cloze.acceptedAnswers[0]
          : task.kind === 'write-word' ? entry.writing.acceptedAnswers[0]
            : task.kind === 'choose-article' ? entry.nounData!.article : entryId,
      }, lessonOneBundle, NOW)
      if (mode === 'feedback') break
    }
    state = transition(state, { type: 'next', taskId: task.taskId }, lessonOneBundle, NOW)
    if (mode === 'paused' && currentTask(state)?.kind === 'cloze') break
  }
  const session = state.session!
  const currentId = session.queue[session.cursor]?.taskId
  // Keep a faithful phase-one queue: it had no write-word/article questions.
  const queue = session.queue.filter(task => task.kind !== 'write-word' && task.kind !== 'choose-article' && task.kind !== 'reverse-card')
  const attempts = state.attempts.filter(attempt => attempt.exercise !== 'write-word' && attempt.exercise !== 'choose-article')
    .map(({ assisted, normalizationVersion, ...attempt }): LegacyAttempt => {
      void assisted; void normalizationVersion
      return { ...attempt, exercise: attempt.exercise as LegacyAttempt['exercise'] }
    })
  const progress = Object.fromEntries(Object.entries(state.progress).map(([entryId, value]) => {
    const { skills: _skills, ...item } = value
    void _skills
    const entryAttempts = attempts.filter(attempt => attempt.entryId === entryId)
    return [entryId, { ...item, correctCount: entryAttempts.filter(attempt => attempt.correct).length,
      wrongCount: entryAttempts.filter(attempt => !attempt.correct).length }]
  }))
  const { assisted: _assisted, ...feedback } = session.feedback ?? { assisted: false }
  void _assisted
  const old: LegacyState = {
    schemaVersion: 1, learningPolicyVersion: 'learning-policy-v1', contentVersion: 'lesson-01-excerpt-v1', revision: 25,
    settings: { studyTimeZone: state.settings.studyTimeZone, maxNewPerSession: 5 }, progress, attempts,
    session: { sessionId: session.sessionId, contentVersion: 'lesson-01-excerpt-v1',
      state: mode === 'ended' ? 'ended' : mode === 'feedback' || mode === 'match' ? 'active' : 'paused', startedAt: session.startedAt,
      endedAt: mode === 'ended' ? NOW : null, queue, cursor: currentId ? queue.findIndex(task => task.taskId === currentId) : queue.length,
      introducedEntryIds: session.introducedEntryIds, draft: mode === 'draft' ? '  Hal' : '',
      feedback: session.feedback ? feedback as NonNullable<LegacyState['session']>['feedback'] : null },
  }
  validateLegacyState(old, legacyBundle)
  return old
}

test('migration preserves paused/ended/current feedback/match/draft records and derives honest skill/time fields', () => {
  for (const mode of ['paused', 'ended', 'feedback', 'match', 'draft'] as const) {
    const old = legacySample(mode)
    const before = structuredClone(old)
    const migrated = migrateState(old, lessonOneBundle)
    validateState(migrated, lessonOneBundle)
    assert.deepEqual(old, before, 'pure migration does not mutate its input')
    assert.equal(migrated.schemaVersion, 4)
    assert.equal(migrated.revision, old.revision + 1)
    assert.equal(migrated.session!.cursor, old.session!.cursor)
    assert.deepEqual(migrated.session!.queue, old.session!.queue)
    assert.equal(migrated.session!.draft, old.session!.draft)
    assert.equal(migrated.session!.feedback?.expectedAnswer, old.session!.feedback?.expectedAnswer)
    assert.deepEqual(migrated.attempts.map(({ assisted, normalizationVersion, ...attempt }) => {
      void assisted; void normalizationVersion
      return attempt
    }), old.attempts)
    assert.ok(migrated.attempts.every(attempt => !attempt.assisted && attempt.normalizationVersion === 'answer-normalization-v1'))
    for (const [id, progress] of Object.entries(old.progress)) {
      assert.equal(migrated.progress[id].nextDueAt, progress.nextDueAt)
      assert.equal(migrated.progress[id].intervalIndex, progress.intervalIndex)
      assert.deepEqual(migrated.progress[id].scheduledReviewDates, progress.scheduledReviewDates)
      assert.equal(migrated.progress[id].skills.meaning.correct,
        old.attempts.filter(attempt => attempt.entryId === id && attempt.correct && attempt.exercise !== 'cloze').length)
    }
    assert.deepEqual(migrated.dailyActivity, {})
    assert.equal(migrated.session!.activeMs, 0, 'old active time is not invented')
    assert.equal(migrated.session!.targetAcknowledgedDate, null)
    assert.deepEqual(migrateState(migrated, lessonOneBundle), migrated, 'second migration does not increment revision')
    assert.throws(() => validateLegacyState(migrated, legacyBundle), /./, 'old reader explicitly rejects v2')
  }
})

test('legacy schema-1 saves still migrate into the real three-lesson catalog without losing drafts or evidence', () => {
  for (const mode of ['paused', 'ended', 'feedback', 'draft', 'match'] as const) {
    const old = legacySample(mode)
    const expected = migrateState(old, lessonOneBundle)
    const actual = migrateState(old, courseBundle)
    assert.deepEqual(actual, { ...expected, contentVersion: courseBundle.contentVersion,
      session: expected.session ? { ...expected.session, contentVersion: courseBundle.contentVersion } : null })
  }
})

test('unknown or damaged prior data is preserved and rejected', () => {
  const old = legacySample()
  for (const invalid of [{ ...old, contentVersion: 'unknown-v1' }, { ...old, schemaVersion: 4 },
    { ...old, session: { ...old.session, cursor: 9999 } }, { ...old, attempts: [...old.attempts, ...old.attempts] }]) {
    const before = structuredClone(invalid)
    assert.throws(() => migrateState(invalid, lessonOneBundle))
    assert.deepEqual(invalid, before)
  }
})

test('migration derives assisted status from a prior wrong matching guess without changing the old result', () => {
  const old = legacySample('match')
  const task = old.session!.queue[old.session!.cursor]
  assert.equal(task.kind, 'match')
  const [id, other] = task.entryIds
  const entry = lessonOneBundle.entries.find(item => item.entryId === id)!
  const base = { sessionId: old.session!.sessionId, taskId: task.taskId, entryId: id,
    exercise: 'match' as const, independent: false, at: NOW, studyDate: '2026-10-28' }
  old.attempts.push({ ...base, attemptId: 'old-wrong-guess', answer: other, correct: false },
    { ...base, attemptId: 'old-correct-guess', answer: id, correct: true })
  task.matchedEntryIds.push(id)
  old.progress[id].correctCount++
  old.progress[id].wrongCount++
  old.progress[id].pendingError = { sessionId: old.session!.sessionId, remainingOtherAnswers: 3, at: NOW }
  old.progress[id].intervalIndex = 0
  old.progress[id].scheduledReviewDates = []
  old.progress[id].nextDueAt = NOW
  old.session!.feedback = { attemptId: 'old-correct-guess', entryId: id, correct: true,
    expectedAnswer: entry.meaningFa, explanationFa: 'بازخورد قدیمی محفوظ است.' }
  validateLegacyState(old, legacyBundle)
  const migrated = migrateState(old, lessonOneBundle)
  assert.equal(migrated.attempts.at(-2)!.assisted, false)
  assert.equal(migrated.attempts.at(-1)!.assisted, true)
  assert.equal(migrated.attempts.at(-1)!.correct, true)
  assert.equal(migrated.attempts.at(-1)!.answer, id)
  assert.equal(migrated.attempts.at(-1)!.independent, false)
  assert.equal(migrated.session!.feedback!.assisted, true)
  assert.equal(migrated.progress[id].skills.meaning.assisted, 1)
  assert.equal(migrated.progress[id].skills.meaning.unassistedCorrect,
    old.attempts.filter(attempt => attempt.entryId === id && attempt.exercise === 'choose-meaning' && attempt.correct).length)
})

test('load migrates in one transaction, second load is idempotent and post-migration writing persists (IDB model)', async t => {
  const previous = globalThis.indexedDB
  t.after(() => { globalThis.indexedDB = previous })
  const model = indexedDBModel(legacySample('draft'))
  globalThis.indexedDB = model.factory
  const loaded = (await loadState(lessonOneBundle))!
  assert.equal(loaded.schemaVersion, 4)
  assert.equal(loaded.revision, 26)
  assert.deepEqual(model.keys(), ['current'], 'migration creates no backup key or feature')
  const again = (await loadState(lessonOneBundle))!
  assert.deepEqual(again, loaded)
  let next = transition(loaded, { type: 'start-session', sessionId: 'resume-legacy', seed: 2 }, lessonOneBundle, NOW)
  await saveState(next, loaded.revision)
  const task = currentTask(next)!
  assert.equal(task.kind, 'cloze')
  next = transition(next, { type: 'answer', taskId: task.taskId, attemptId: 'after-migration', answer: lessonOneBundle.entries[0].cloze.acceptedAnswers[0] }, lessonOneBundle, NOW)
  await saveState(next, next.revision - 1)
  const restored = (await loadState(lessonOneBundle))!
  assert.equal(restored.attempts.at(-1)!.attemptId, 'after-migration')
  assert.equal(restored.session!.feedback!.attemptId, 'after-migration')
  assert.equal(restored.progress[lessonOneBundle.entries[0].entryId].skills.writing.unassistedCorrect, 1)
  // A later v2 session can add the new typed exercise without losing the migrated history.
  let live = restored
  const commit = async (value: Parameters<typeof transition>[1]) => {
    const changed = transition(live, value, lessonOneBundle, NOW)
    assert.notEqual(changed, live)
    await saveState(changed, live.revision)
    live = changed
  }
  await commit({ type: 'end-session' })
  await commit({ type: 'start-session', sessionId: 'new-v2-session', seed: 12 })
  for (let count = 0; count < 80; count++) {
    const current = currentTask(live)!
    if (current.kind === 'write-word') break
    if (current.kind === 'flashcard') await commit({ type: 'reveal-card', taskId: current.taskId })
    else {
      assert.notEqual(current.kind, 'match')
      const id = current.kind === 'match' ? current.entryIds[0] : current.entryId
      const entry = lessonOneBundle.entries.find(item => item.entryId === id)!
      await commit({ type: 'answer', taskId: current.taskId, attemptId: `v2-transition-${count}`,
        answer: current.kind === 'cloze' ? entry.cloze.acceptedAnswers[0] : current.kind === 'choose-article' ? entry.nounData!.article : id })
    }
    await commit({ type: 'next', taskId: current.taskId })
  }
  const typed = currentTask(live)!
  assert.equal(typed.kind, 'write-word')
  await commit({ type: 'answer', taskId: typed.taskId, attemptId: 'new-typed-after-migration',
    answer: lessonOneBundle.entries.find(entry => entry.entryId === typed.entryId)!.writing.acceptedAnswers[0] })
  const written = (await loadState(lessonOneBundle))!
  assert.equal(written.attempts.at(-1)!.exercise, 'write-word')
  assert.equal(written.attempts.at(-1)!.attemptId, 'new-typed-after-migration')
  assert.ok(written.attempts.some(attempt => attempt.attemptId === 'legacy-attempt-0'))
})

test('failed migration transaction preserves original v1 snapshot; invalid data is never overwritten (IDB model)', async t => {
  const previous = globalThis.indexedDB
  t.after(() => { globalThis.indexedDB = previous })
  const old = legacySample('feedback')
  const model = indexedDBModel(old)
  globalThis.indexedDB = model.factory
  model.failNextPut()
  await assert.rejects(loadState(lessonOneBundle))
  assert.deepEqual(model.read(), old)
  assert.equal((await loadState(lessonOneBundle))!.schemaVersion, 4, 'a later retry can migrate the preserved snapshot')
  const damaged = { ...old, contentVersion: 'unknown' }
  const corruptModel = indexedDBModel(damaged)
  globalThis.indexedDB = corruptModel.factory
  await assert.rejects(loadState(lessonOneBundle))
  assert.deepEqual(corruptModel.read(), damaged)
})
