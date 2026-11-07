import assert from 'node:assert/strict'
import test from 'node:test'
import { courseBundle, lessonBundles } from './catalog.ts'
import { withTextbookStudyOrder } from './textbook-study-order.ts'
import { validateContent } from './validate.ts'
import { createInitialState, transition } from '../learning/engine.ts'

const [lessonOneBundle, lessonFourBundle, lessonFiveBundle, lessonSixBundle, lessonSevenBundle, lessonEightBundle] = lessonBundles

test('lessons one and four use printed textbook page order for new flashcards', () => {
  const now = '2026-11-06T12:00:00.000Z'
  for (const [bundle, firstFive, pageCount] of [
    [lessonOneBundle, ['Hallo', 'Guten Tag', 'heißen', 'kommen', 'Land'], 19],
    [lessonFourBundle, ['allein', 'Fahrt', 'Interesse', 'laufen', 'regelmäßig'], 55],
  ] as const) {
    const ordered = bundle.entries.toSorted((a, b) => a.introductionOrder - b.introductionOrder)
    const pages = ordered.map(entry => Math.min(...bundle.sourceRefs
      .filter(ref => ref.sourceId === 'source-textbook' && entry.sourceRefIds.includes(ref.sourceRefId))
      .map(ref => Number(ref.locator.split('چاپی ')[1]))))
    assert.deepEqual(pages, pages.toSorted((a, b) => a - b))
    assert.equal(pages.filter(Number.isFinite).length, pageCount)
    assert.deepEqual(ordered.map(entry => entry.entryId), bundle.lesson.introducedEntryIds)
    assert.deepEqual(ordered.slice(0, 5).map(entry => entry.lemma), firstFive)

    const selected = transition(createInitialState(courseBundle, 'Europe/Berlin'), { type: 'select-lesson', lessonId: bundle.lesson.lessonId }, courseBundle, now)
    const started = transition(selected, { type: 'start-session', sessionId: 'textbook-page-order', seed: 1 }, courseBundle, now)
    assert.deepEqual(started.session!.queue.filter(task => task.kind === 'flashcard').map(task => task.entryId),
      bundle.lesson.introducedEntryIds.slice(0, 5))
  }
})
test('a later lesson uses printed pages even when textbook locators include notes', () => {
  const bundle = structuredClone(lessonFiveBundle)
  bundle.lesson.lessonId = 'lesson-06'
  const [workbookOnly, later, earlier, samePage] = bundle.entries
  bundle.entries = [workbookOnly, later, earlier, samePage]
  bundle.sourceRefs = [
    { sourceRefId: 'workbook', sourceId: 'source-workbook', lessonId: 'lesson-06', locator: 'کتاب تمرین: PDF 12، چاپی 10' },
    { sourceRefId: 'later', sourceId: 'source-textbook', lessonId: 'lesson-06', locator: 'کتاب درسی: PDF 61، چاپی 59' },
    { sourceRefId: 'earlier', sourceId: 'source-textbook', lessonId: 'lesson-06', locator: 'کتاب درسی: PDF 60، چاپی 58 [شکل متن: Freunde]' },
  ]
  workbookOnly.sourceRefIds = ['workbook']
  later.sourceRefIds = ['later']
  earlier.sourceRefIds = ['later', 'earlier']
  samePage.sourceRefIds = ['earlier']

  const ordered = withTextbookStudyOrder(bundle)
  assert.deepEqual(ordered.lesson.introducedEntryIds, [earlier.entryId, samePage.entryId, later.entryId, workbookOnly.entryId])
  assert.deepEqual(ordered.entries.map(entry => entry.introductionOrder), [4, 3, 1, 2])
  assert.deepEqual(ordered.entries.map(entry => entry.entryId), bundle.entries.map(entry => entry.entryId))
})

test('the catalog exposes lessons 1, 4, 5, 6, 7 and 8 with 367 entries and unchanged existing identities', () => {
  assert.deepEqual(validateContent(courseBundle), [])
  assert.equal(courseBundle.entries.length, 367)
  assert.deepEqual(courseBundle.lessons?.map(lesson => lesson.lessonId), [lessonOneBundle.lesson.lessonId, 'lesson-04', 'lesson-05', 'lesson-06', 'lesson-07', 'lesson-08'])
  assert.deepEqual(courseBundle.entries.slice(0, 20).map(entry => ({ ...entry, examples: entry.examples.slice(0, 1) })), lessonOneBundle.entries)
  assert.deepEqual(courseBundle.entries.slice(20, 104).map(entry => ({ ...entry, examples: entry.examples.slice(0, 1) })), lessonFourBundle.entries)
  assert.deepEqual(courseBundle.entries.slice(104, 180).map(entry => ({ ...entry, examples: entry.examples.slice(0, 1) })), lessonFiveBundle.entries)
  assert.deepEqual(courseBundle.entries.slice(180, 260).map(entry => ({ ...entry, examples: entry.examples.slice(0, 1) })), lessonSixBundle.entries)
  assert.deepEqual(courseBundle.entries.slice(260, 315).map(entry => ({ ...entry, examples: entry.examples.slice(0, 1) })), lessonSevenBundle.entries)
  assert.deepEqual(courseBundle.entries.slice(315).map(entry => ({ ...entry, examples: entry.examples.slice(0, 1) })), lessonEightBundle.entries)
  assert.equal(new Set(courseBundle.entries.map(entry => entry.entryId)).size, 367)
  assert.equal(new Set(courseBundle.sourceRefs.map(ref => ref.sourceRefId)).size, courseBundle.sourceRefs.length)
})

test('lesson-aware validation rejects cross-lesson options and broken introduction/source mappings', () => {
  const badOption = structuredClone(courseBundle)
  badOption.entries[20].meaningOptionEntryIds[1] = badOption.entries[0].entryId
  assert.ok(validateContent(badOption).some(error => error.includes('meaning options')))
  const badIntroduction = structuredClone(courseBundle)
  badIntroduction.lessons![1].introducedEntryIds[0] = badIntroduction.entries[0].entryId
  assert.ok(validateContent(badIntroduction).some(error => error.includes('Introduction IDs')))
  const badSource = structuredClone(courseBundle)
  badSource.sourceRefs[0].lessonId = 'missing-lesson'
  assert.ok(validateContent(badSource).some(error => error.includes('source reference')))
})
