import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lessonTwoBundle } from '../content/lesson-two.ts'
import { LEGACY_NORMALIZATION_VERSION, NORMALIZATION_VERSION } from '../contracts/index.ts'
import type { LearningCommand } from '../contracts/index.ts'
import { createInitialState, currentTask, normalizeAnswer, transition } from './engine.ts'
import { migrateState, validateState } from '../storage/index.ts'

const NOW = '2026-11-12T12:00:00.000Z'
const entry = lessonTwoBundle.entries.find(entry => entry.entryId === 'it-a1-l02-016')!
const bundle = { ...lessonTwoBundle, entries: lessonTwoBundle.entries.map(item => ({ ...item,
  introductionOrder: item.entryId === entry.entryId ? 0 : item.introductionOrder + 1,
})) }

function ready(kind: 'cloze' | 'write-word') {
  let state = createInitialState(bundle, 'Europe/Berlin')
  const apply = (command: LearningCommand) => {
    state = transition(state, command, bundle, NOW)
    validateState(state, bundle)
  }
  apply({ type: 'start-session', sessionId: `apostrophe-${kind}`, seed: 19 })
  for (let count = 0; count < 160; count++) {
    const task = currentTask(state)!
    assert.ok(task)
    if (!state.session!.feedback && task.kind === kind && task.entryId === entry.entryId) return state
    if (state.session!.feedback) { apply({ type: 'next', taskId: task.taskId }); continue }
    if (task.kind === 'flashcard') {
      apply({ type: 'reveal-card', taskId: task.taskId })
      apply({ type: 'next', taskId: task.taskId })
      continue
    }
    if (task.kind === 'reverse-card') throw new Error('Unexpected same-day reverse card')
    const id = task.kind === 'match' ? task.entryIds.find(id => !task.matchedEntryIds.includes(id))! : task.entryId
    const target = bundle.entries.find(item => item.entryId === id)!
    const answer = task.kind === 'cloze' ? target.cloze.acceptedAnswers[0]
      : task.kind === 'write-word' ? target.writing.acceptedAnswers[0]
        : task.kind === 'choose-article' ? target.nounData!.article! : id
    apply({ type: 'answer', taskId: task.taskId, entryId: id, attemptId: `setup-${count}`, answer })
  }
  throw new Error('Target written exercise was not reached')
}

test('apostrophe typography is equivalent without folding accents or removing punctuation', () => {
  for (const apostrophe of ["'", '’', '‘', 'ʼ', '＇']) {
    assert.equal(normalizeAnswer(`  non  c${apostrophe}e\u0300  male  `), "non c'è male")
    assert.equal(normalizeAnswer(`l${apostrophe}acqua`), "l'acqua")
  }
  for (const incorrect of ['non ćè male', 'non cè male', "non c'e male", 'non cé male', 'non c`è male']) {
    assert.notEqual(normalizeAnswer(incorrect), normalizeAnswer('non c’è male'))
  }
})

for (const kind of ['cloze', 'write-word'] as const) {
  test(`${kind} accepts keyboard apostrophes while keeping the raw answer and accent errors`, () => {
    const original = ready(kind), task = currentTask(original)!
    for (const [index, apostrophe] of ["'", '’', '‘', 'ʼ', '＇'].entries()) {
      const answer = `  non  c${apostrophe}e\u0300  male  `
      const next = transition(original, { type: 'answer', taskId: task.taskId, attemptId: `variant-${index}`, answer }, bundle, NOW)
      assert.equal(next.session!.feedback!.correct, true)
      assert.equal(next.attempts.at(-1)!.answer, answer)
      assert.equal(next.attempts.at(-1)!.normalizationVersion, NORMALIZATION_VERSION)
      validateState(next, bundle)
      assert.deepEqual(migrateState(next, bundle), next)
    }
    for (const answer of ['non ćè male', "non c'e male", 'non cè male']) {
      const next = transition(original, { type: 'answer', taskId: task.taskId, attemptId: `incorrect-${answer}`, answer }, bundle, NOW)
      assert.equal(next.session!.feedback!.correct, false)
      assert.ok(next.progress[entry.entryId].pendingError)
      validateState(next, bundle)
    }
  })
}

test('v1 evidence and v2 answers coexist without regrading or rewriting earlier attempts', () => {
  const state = ready('write-word')
  for (const attempt of state.attempts) attempt.normalizationVersion = LEGACY_NORMALIZATION_VERSION
  const before = structuredClone(state)
  assert.deepEqual(migrateState(state, bundle), before)
  const next = transition(state, { type: 'answer', taskId: currentTask(state)!.taskId,
    attemptId: 'new-v2', answer: 'non cʼè male' }, bundle, NOW)
  assert.deepEqual(next.attempts.slice(0, -1), before.attempts)
  assert.equal(next.attempts.at(-1)!.normalizationVersion, NORMALIZATION_VERSION)
  assert.equal(next.session!.feedback!.correct, true)
  assert.deepEqual(migrateState(next, bundle), next)
  assert.deepEqual(state, before)
})
