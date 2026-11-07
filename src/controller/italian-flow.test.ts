import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AppState, ContentBundle, Entry, LearningCommand, SessionTask } from '../contracts/index.ts'
import { courseBundle as bundle } from '../content/catalog.ts'
import { createInitialState, currentTask, getHomeStats, transition } from '../learning/engine.ts'
import { migrateState, validateState } from '../storage/index.ts'

const NOW = '2026-11-07T12:00:00.000Z'

function apply(state: AppState, command: LearningCommand, content = bundle): AppState {
  const next = transition(state, command, content, NOW)
  if (next !== state) assert.equal(next.revision, state.revision + 1)
  validateState(next, content)
  return next
}

function answerFor(task: SessionTask, content: ContentBundle): Extract<LearningCommand, { type: 'answer' }> {
  assert.notEqual(task.kind, 'flashcard')
  assert.notEqual(task.kind, 'reverse-card')
  if (task.kind === 'flashcard' || task.kind === 'reverse-card') throw new Error('A visible card has no answer attempt')
  const id = task.kind === 'match' ? task.entryIds.find(id => !task.matchedEntryIds.includes(id))! : task.entryId
  const entry = content.entries.find(entry => entry.entryId === id)!
  const answer = task.kind === 'cloze' ? entry.cloze.acceptedAnswers[0]
    : task.kind === 'write-word' ? entry.writing.acceptedAnswers[0]
      : task.kind === 'choose-article' ? entry.nounData!.article! : id
  return { type: 'answer', taskId: task.taskId, entryId: id, attemptId: `answer-${task.taskId}-${id}`, answer }
}

function step(state: AppState, content = bundle): AppState {
  const task = currentTask(state)!
  if (state.session!.feedback) return apply(state, { type: 'next', taskId: task.taskId }, content)
  if (task.kind === 'flashcard') {
    state = apply(state, { type: 'reveal-card', taskId: task.taskId }, content)
    return apply(state, { type: 'next', taskId: task.taskId }, content)
  }
  return apply(state, answerFor(task, content), content)
}

/** Ordering is a test fixture only; stable identities and actual Italian answers are unchanged. */
function focus(entry: Entry): ContentBundle {
  return { ...bundle, entries: bundle.entries.map(item => ({ ...item,
    introductionOrder: item.entryId === entry.entryId ? 0 : item.introductionOrder + 1,
  })) }
}

function reachWriting(content: ContentBundle, entryId?: string): AppState {
  let state = apply(createInitialState(content, 'Europe/Berlin'), { type: 'start-session', sessionId: 'written-fixture', seed: 41 }, content)
  for (let count = 0; count < 160; count++) {
    const task = currentTask(state)
    assert.ok(task, 'written task must be reachable through the real session')
    if (task.kind === 'write-word' && !state.session!.feedback && (!entryId || task.entryId === entryId)) return state
    state = step(state, content)
  }
  throw new Error('Bounded session did not reach writing')
}

test('all 85 real Italian entries traverse every applicable exercise with five-card batches and valid snapshots', () => {
  assert.equal(bundle.entries.length, 85)
  assert.equal(bundle.lesson.lessonId, 'it-a1-lesson-01')
  assert.equal((bundle.lessons ?? [bundle.lesson]).length, 1)
  let state = createInitialState(bundle, 'Europe/Berlin')
  validateState(state, bundle)
  const introduced = new Set<string>()
  const exercises = new Map<string, Set<string>>()
  for (let batch = 0; batch < 17; batch++) {
    state = apply(state, { type: 'start-session', sessionId: `italian-batch-${batch}`, seed: 17 + batch })
    const queue = state.session!.queue
    const lastCard = queue.findLastIndex(task => task.kind === 'flashcard')
    const firstPractice = queue.findIndex(task => task.kind !== 'flashcard' && task.kind !== 'reverse-card')
    assert.ok(lastCard >= 0 && lastCard < firstPractice, 'all new cards precede practice of that batch')
    assert.equal(queue.filter(task => task.kind === 'flashcard').length, 5)
    for (let count = 0; currentTask(state); count++) {
      assert.ok(count < 180, 'actual session must finish without invented filler work')
      const task = currentTask(state)!
      if (state.session!.feedback) { state = step(state); continue }
      if (task.kind === 'flashcard') {
        const attemptsBefore = state.attempts.length
        const progressBefore = structuredClone(state.progress[task.entryId])
        state = apply(state, { type: 'reveal-card', taskId: task.taskId })
        assert.equal(state.attempts.length, attemptsBefore)
        assert.deepEqual(state.progress[task.entryId], progressBefore, 'viewing cannot create recall or mastery')
        state = apply(state, { type: 'next', taskId: task.taskId })
        continue
      }
      assert.notEqual(task.kind, 'reverse-card', 'new same-day completions are not yet due for reverse review')
      if (task.kind === 'reverse-card') throw new Error('Unexpected same-day reverse task')
      const ids = task.kind === 'match' ? task.entryIds : [task.entryId]
      if (task.kind === 'match') assert.equal(new Set(ids.map(id => bundle.entries.find(entry => entry.entryId === id)!.meaningFa)).size, 4)
      if (task.kind === 'choose-meaning') assert.equal(new Set(task.optionIds.map(id => bundle.entries.find(entry => entry.entryId === id)!.meaningFa)).size, 4)
      for (const id of ids) {
        const entry = bundle.entries.find(entry => entry.entryId === id)!
        assert.equal(entry.introducedInLessonId, bundle.lesson.lessonId)
        const seen = exercises.get(id) ?? new Set<string>()
        seen.add(task.kind); exercises.set(id, seen)
        if (task.kind === 'choose-article') {
          assert.equal(entry.partOfSpeech, 'noun')
          assert.ok(entry.nounData?.article, 'unknown articles and non-nouns cannot create article questions')
          assert.ok(task.options.includes(entry.nounData!.article!))
        }
      }
      const command = answerFor(task, bundle)
      state = apply(state, command)
      assert.equal(state.session!.feedback!.correct, true, 'task-specific canonical answers must be accepted')
      const committed = state
      assert.equal(apply(state, command), committed, 'duplicate attempt IDs cannot count twice')
      const restored = migrateState(structuredClone(state), bundle)
      assert.deepEqual(restored, state, 'snapshot restoration preserves original attempts and feedback')
      state = restored
    }
    assert.equal(state.session!.state, 'ended')
    assert.equal(state.session!.introducedEntryIds.length, 5)
    for (const id of state.session!.introducedEntryIds) {
      assert.ok(!introduced.has(id), 'an earlier introduced word must not be new again')
      introduced.add(id)
    }
    assert.equal(getHomeStats(state, bundle, NOW).stabilized, 0, 'one-day games/practice are not mastery')
  }
  assert.equal(introduced.size, 85)
  assert.equal(getHomeStats(state, bundle, NOW).newCount, 0)
  for (const entry of bundle.entries) {
    const seen = exercises.get(entry.entryId)!
    for (const kind of ['choose-meaning', 'cloze', 'write-word']) assert.ok(seen.has(kind), `${entry.entryId}: ${kind}`)
    assert.equal(seen.has('choose-article'), Boolean(entry.partOfSpeech === 'noun' && entry.nounData?.article))
    const progress = state.progress[entry.entryId]
    assert.equal(progress.wrongCount, 0)
    assert.equal(progress.initialRecallPending, false)
    assert.equal(progress.intervalIndex, 0)
    assert.equal(progress.nextDueAt, '2026-11-08T12:00:00.000Z')
  }
})

test('Italian writing preserves accents, normalizes NFC/whitespace, and accepts only explicit alternatives', () => {
  const entry = bundle.entries.find(entry => /[àèéìòù]/iu.test(entry.writing.acceptedAnswers[0]))!
  assert.ok(entry, 'actual Italian lesson must contain accented answers')
  const content = focus(entry)
  const ready = reachWriting(content, entry.entryId)
  const task = currentTask(ready)!
  for (const [index, answer] of entry.writing.acceptedAnswers.entries()) {
    const state = apply(ready, { type: 'answer', taskId: task.taskId, attemptId: `explicit-${index}`, answer }, content)
    assert.equal(state.session!.feedback!.correct, true)
  }
  const raw = `  ${entry.writing.acceptedAnswers[0].normalize('NFD')}  `
  const normalized = apply(ready, { type: 'answer', taskId: task.taskId, attemptId: 'decomposed', answer: raw }, content)
  assert.equal(normalized.session!.feedback!.correct, true)
  assert.equal(normalized.attempts.at(-1)!.answer, raw, 'raw submitted answer remains intact')
  const unaccented = entry.writing.acceptedAnswers[0].normalize('NFD').replace(/\p{M}/gu, '')
  assert.ok(!entry.writing.acceptedAnswers.some(answer => answer.toLocaleLowerCase('it') === unaccented.toLocaleLowerCase('it')))
  const wrong = apply(ready, { type: 'answer', taskId: task.taskId, attemptId: 'accent-missing', answer: unaccented }, content)
  assert.equal(wrong.session!.feedback!.correct, false, 'accent removal is not implicit normalization')
})

test('pending Italian draft, queue and feedback survive pause and snapshot restoration', () => {
  let state = reachWriting(bundle)
  const task = currentTask(state)!
  state = apply(state, { type: 'draft', taskId: task.taskId, value: '  risposta incompleta  ' })
  state = apply(state, { type: 'pause' })
  const paused = structuredClone(state)
  state = migrateState(structuredClone(state), bundle)
  state = apply(state, { type: 'start-session', sessionId: 'unused-resume-id', seed: 8 })
  assert.deepEqual(state.session!.queue, paused.session!.queue)
  assert.equal(state.session!.cursor, paused.session!.cursor)
  assert.equal(state.session!.draft, paused.session!.draft)
  assert.equal(state.session!.sessionId, paused.session!.sessionId)
  state = apply(state, answerFor(currentTask(state)!, bundle))
  const feedback = structuredClone(state.session!.feedback)
  const attempts = structuredClone(state.attempts)
  state = apply(state, { type: 'pause' })
  state = migrateState(structuredClone(state), bundle)
  state = apply(state, { type: 'start-session', sessionId: 'unused-feedback-resume', seed: 9 })
  assert.deepEqual(state.session!.feedback, feedback)
  assert.deepEqual(state.attempts, attempts)
})

test('synthetic second Italian lesson preserves independent drafts and shared daily activity without claiming book content', () => {
  const firstId = bundle.lesson.lessonId, secondId = 'fixture-it-lesson-02'
  const ids = new Map(bundle.entries.map(entry => [entry.entryId, `fixture-two-${entry.entryId}`]))
  const secondEntries = bundle.entries.map(entry => ({ ...entry, entryId: ids.get(entry.entryId)!, introducedInLessonId: secondId,
    meaningOptionEntryIds: entry.meaningOptionEntryIds.map(id => ids.get(id)!),
  }))
  const second = { ...bundle.lesson, lessonId: secondId, titleIt: 'Lezione di prova', titleFa: 'درس صرفاً آزمایشی',
    introducedEntryIds: bundle.lesson.introducedEntryIds.map(id => ids.get(id)!),
  }
  const content: ContentBundle = { ...bundle, lessons: [bundle.lesson, second], entries: [...bundle.entries, ...secondEntries] }
  let state = reachWriting(content)
  const task = currentTask(state)!
  state = apply(state, { type: 'draft', taskId: task.taskId, value: 'prima risposta' }, content)
  const end = '2026-11-07T12:00:01.000Z'
  state = transition(state, { type: 'activity', eventId: 'first-active-second', sessionId: state.session!.sessionId, from: NOW, to: end, elapsedMs: 1000 }, content, end)
  validateState(state, content)
  const first = { ...structuredClone(state.session!), state: 'paused' as const }
  state = apply(state, { type: 'select-lesson', lessonId: secondId }, content)
  assert.deepEqual(state.savedSessions[firstId], first)
  assert.equal(state.session, null)
  state = apply(state, { type: 'start-session', sessionId: 'second-lesson-session', seed: 19 }, content)
  assert.ok(state.session!.queue.every(task => (task.kind === 'match' ? task.entryIds : [task.entryId]).every(id => id.startsWith('fixture-two-'))))
  const secondSession = { ...structuredClone(state.session!), state: 'paused' as const }
  state = apply(state, { type: 'select-lesson', lessonId: firstId }, content)
  assert.deepEqual(state.session, first)
  assert.deepEqual(state.savedSessions[secondId], secondSession)
  assert.equal(getHomeStats(state, content, NOW).todayActiveMs, 1000)
  const duplicate = structuredClone(state)
  duplicate.savedSessions[secondId].sessionId = duplicate.session!.sessionId
  assert.throws(() => validateState(duplicate, content))
})
