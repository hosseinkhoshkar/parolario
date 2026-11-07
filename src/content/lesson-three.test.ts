import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { AppState, LearningCommand, SessionTask } from '../contracts/index.ts'
import { courseBundle as bundle } from './catalog.ts'
import { lessonThreeBundle } from './lesson-three.ts'
import { parseItalianSource } from '../../scripts/example-catalog.mjs'
import oldDigests from './fixtures/pre-lesson-three-content-digests.json' with { type: 'json' }
import occurrences from './lesson-three-occurrences.json' with { type: 'json' }
import { validateContent } from './validate.ts'
import { withTextbookStudyOrder } from './textbook-study-order.ts'
import { hasArticle } from '../learning/articles.ts'
import { createInitialState, currentTask, getHomeStats, transition } from '../learning/engine.ts'
import { migrateState, validateState } from '../storage/index.ts'

const THIRD = 'it-a1-lesson-03'
const NOW = '2026-11-10T12:00:00.000Z'
const rows = parseItalianSource(readFileSync('reference/vocabulary/italian/Lesson-03-A1.txt', 'utf8'), 'Lesson-03-A1.txt')
function normalize(value: unknown): unknown {
  return Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize((value as Record<string, unknown>)[key])])) : value
}

test('all 177 pre-lesson-three entries retain frozen identities, answers, examples and exercise data', () => {
  assert.equal(Object.keys(oldDigests).length, 177)
  const old = bundle.entries.filter(entry => entry.introducedInLessonId !== THIRD)
  assert.equal(old.length, Object.keys(oldDigests).length)
  for (const entry of old) {
    const { sourceRefIds, occurrences: refs, ...core } = entry
    void sourceRefIds; void refs
    assert.equal(createHash('sha256').update(JSON.stringify(normalize(core))).digest('hex'), oldDigests[entry.entryId as keyof typeof oldDigests], entry.entryId)
  }
})

test('each third-lesson source row preserves its Persian meaning, exact quote and paired examples in page order', () => {
  assert.deepEqual(validateContent(bundle), [])
  assert.deepEqual(validateContent(lessonThreeBundle), [])
  assert.equal(lessonThreeBundle.lesson.lessonId, THIRD)
  assert.equal(lessonThreeBundle.lesson.titleIt, 'Buon appetito')
  assert.equal(lessonThreeBundle.lesson.coverage, 'partial')
  assert.equal(lessonThreeBundle.entries.length, rows.length)
  assert.equal(rows.length, 109)
  assert.equal(bundle.entries.length, Object.keys(oldDigests).length + rows.length)
  const ordered = withTextbookStudyOrder(lessonThreeBundle)
  const previous = bundle.entries.filter(entry => entry.introducedInLessonId !== THIRD)
  let lastPage = 0
  for (const row of rows) {
    const entry = lessonThreeBundle.entries.find(entry => entry.sourceRow === row.row)!
    assert.ok(entry)
    assert.equal(entry.entryId, `it-a1-l03-${String(row.row).padStart(3, '0')}`)
    assert.equal(entry.sourceHeadword, row.word)
    assert.equal(entry.meaningFa, row.meaningFa)
    assert.equal(entry.examples.length, 3)
    assert.equal(entry.examples[0].origin, 'quoted')
    assert.equal(entry.examples[0].it, row.exampleIt)
    assert.equal(entry.examples[0].fa, row.exampleFa)
    assert.equal(lessonThreeBundle.sourceRefs.find(ref => ref.sourceRefId === entry.examples[0].sourceRefId)!.locator, row.locator)
    assert.equal(entry.examples.filter(example => example.origin === 'authored').length, 2)
    assert.equal(entry.cloze.sentence.replace('___', entry.cloze.acceptedAnswers[0]), entry.examples.find(example => example.exampleId === entry.cloze.exampleId)!.it)
    assert.equal(entry.enabledExercises.includes('choose-article'), hasArticle(entry))
    assert.ok(!previous.some(old => old.partOfSpeech === entry.partOfSpeech && old.lemma.toLocaleLowerCase('it') === entry.lemma.toLocaleLowerCase('it')), `reintroduced same-role lemma: ${entry.lemma}`)
    const page = Number(row.locator.match(/چاپی (\d+)/u)![1])
    assert.ok(page >= lastPage, 'the human source file follows textbook page order')
    lastPage = page
  }
  assert.deepEqual(ordered.lesson.introducedEntryIds, rows.map(row => `it-a1-l03-${String(row.row).padStart(3, '0')}`))
  assert.deepEqual(bundle.lessons!.find(lesson => lesson.lessonId === THIRD)!.introducedEntryIds, ordered.lesson.introducedEntryIds)
})

test('third-lesson repetitions append precise occurrences while preserving the original introduction', () => {
  assert.ok(occurrences.length > 0)
  for (const row of occurrences) {
    const entry = bundle.entries.find(entry => entry.entryId === row.entryId)!
    assert.ok(entry && entry.introducedInLessonId !== THIRD)
    const occurrence = entry.occurrences.find(item => item.lessonId === THIRD)!
    assert.ok(occurrence)
    assert.equal(occurrence.sourceRefIds.length, row.refs.length)
    assert.ok(!lessonThreeBundle.lesson.introducedEntryIds.includes(entry.entryId))
    for (const [index, id] of occurrence.sourceRefIds.entries()) {
      assert.ok(entry.sourceRefIds.includes(id))
      const ref = bundle.sourceRefs.find(ref => ref.sourceRefId === id)!
      assert.equal(ref.lessonId, THIRD)
      assert.equal(ref.locator, row.refs[index].locator)
    }
  }
})

function apply(state: AppState, command: LearningCommand): AppState {
  const next = transition(state, command, bundle, NOW)
  validateState(next, bundle)
  return next
}
let sequence = 0
function answerFor(task: SessionTask): Extract<LearningCommand, { type: 'answer' }> {
  if (task.kind === 'flashcard' || task.kind === 'reverse-card') throw new Error('Cards are not answer attempts')
  const id = task.kind === 'match' ? task.entryIds.find(id => !task.matchedEntryIds.includes(id))! : task.entryId
  const entry = bundle.entries.find(entry => entry.entryId === id)!
  return { type: 'answer', taskId: task.taskId, entryId: id, attemptId: `third-real-answer-${++sequence}`,
    answer: task.kind === 'cloze' ? entry.cloze.acceptedAnswers[0] : task.kind === 'write-word' ? entry.writing.acceptedAnswers[0]
      : task.kind === 'choose-article' ? entry.nounData!.article! : id }
}

test('all third-lesson entries complete genuine five-word sessions through every applicable exercise with valid restorable evidence', () => {
  const entries = bundle.entries.filter(entry => entry.introducedInLessonId === THIRD)
  const expected = new Set(entries.map(entry => entry.entryId)), introduced = new Set<string>()
  const exercised = new Map<string, Set<string>>(), allKinds = new Set<string>()
  let state = apply(createInitialState(bundle, 'Europe/Berlin'), { type: 'select-lesson', lessonId: THIRD })
  for (let batch = 0; batch < Math.ceil(entries.length / 5); batch++) {
    state = apply(state, { type: 'start-session', sessionId: `third-real-batch-${batch}`, seed: 309 + batch })
    const planned = state.session!.queue
    assert.equal(planned.filter(task => task.kind === 'flashcard').length, Math.min(5, entries.length - batch * 5))
    assert.ok(planned.findLastIndex(task => task.kind === 'flashcard') < planned.findIndex(task => task.kind !== 'flashcard' && task.kind !== 'reverse-card'))
    for (let count = 0; currentTask(state); count++) {
      assert.ok(count < 220, 'a real session finishes without artificial filler or recovery loops')
      const task = currentTask(state)!
      if (state.session!.feedback) { state = apply(state, { type: 'next', taskId: task.taskId }); continue }
      allKinds.add(task.kind)
      if (task.kind === 'flashcard') {
        assert.ok(expected.has(task.entryId))
        const evidence = structuredClone(state.progress[task.entryId]), attempts = state.attempts.length
        state = apply(state, { type: 'reveal-card', taskId: task.taskId })
        assert.deepEqual(state.progress[task.entryId], evidence)
        assert.equal(state.attempts.length, attempts)
        state = apply(state, { type: 'next', taskId: task.taskId })
        continue
      }
      assert.notEqual(task.kind, 'reverse-card', 'same-day practice creates no due reverse review')
      if (task.kind === 'reverse-card') throw new Error('Unexpected same-day reverse review')
      const ids = task.kind === 'match' ? task.entryIds : [task.entryId]
      assert.ok(ids.every(id => expected.has(id)))
      if (task.kind === 'match' || task.kind === 'choose-meaning') {
        const options = task.kind === 'match' ? task.entryIds : task.optionIds
        assert.ok(options.every(id => expected.has(id)))
        assert.equal(new Set(options.map(id => bundle.entries.find(entry => entry.entryId === id)!.meaningFa)).size, 4)
        assert.equal(new Set(options.map(id => { const entry = bundle.entries.find(entry => entry.entryId === id)!; return entry.meaningGroup ?? entry.meaningFa })).size, 4)
      }
      for (const id of ids) { const kinds = exercised.get(id) ?? new Set<string>(); kinds.add(task.kind); exercised.set(id, kinds) }
      if (task.kind === 'choose-article') {
        const entry = bundle.entries.find(entry => entry.entryId === task.entryId)!
        assert.ok(hasArticle(entry))
        assert.ok(task.options.includes(entry.nounData!.article!))
      }
      const command = answerFor(task)
      state = apply(state, command)
      assert.equal(state.session!.feedback!.correct, true)
      assert.equal(apply(state, command), state, 'duplicate answer IDs cannot count twice')
      assert.deepEqual(migrateState(state, bundle), state)
    }
    assert.equal(state.session!.state, 'ended')
    assert.ok(state.session!.introducedEntryIds.length <= 5)
    for (const id of state.session!.introducedEntryIds) { assert.ok(!introduced.has(id)); introduced.add(id) }
    assert.equal(getHomeStats(state, bundle, NOW).stabilized, 0)
  }
  assert.deepEqual(introduced, expected)
  assert.equal(getHomeStats(state, bundle, NOW).newCount, 0)
  assert.deepEqual(new Set(Object.keys(state.progress)), expected)
  for (const kind of ['flashcard', 'choose-meaning', 'cloze', 'match', 'write-word', 'choose-article']) assert.ok(allKinds.has(kind))
  for (const entry of entries) {
    const kinds = exercised.get(entry.entryId)!
    for (const kind of ['choose-meaning', 'cloze', 'write-word']) assert.ok(kinds.has(kind), `${entry.entryId}: ${kind}`)
    assert.equal(kinds.has('choose-article'), hasArticle(entry))
    assert.equal(state.progress[entry.entryId].skills.article !== null, hasArticle(entry))
    assert.equal(state.progress[entry.entryId].initialRecallPending, false)
    assert.equal(state.progress[entry.entryId].wrongCount, 0)
    assert.equal(state.progress[entry.entryId].intervalIndex, 0)
  }
})
