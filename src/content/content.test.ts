import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { lessonBundles } from './catalog.ts'
const bundle = lessonBundles[0]
import { validateContent } from './validate.ts'
import { parseItalianSource } from '../../scripts/example-catalog.mjs'
import { hasArticle } from '../learning/articles.ts'
const rows = parseItalianSource(readFileSync('reference/vocabulary/italian/Lesson-01-A1.txt', 'utf8'), 'Lesson-01-A1.txt')

test('all 85 Italian source entries, Persian meanings, quotes and precise references remain unchanged', () => {
  assert.deepEqual(validateContent(bundle), [])
  assert.equal(bundle.entries.length, 85)
  assert.equal(bundle.contentVersion, 'nuovo-espresso-a1-it-v1')
  assert.equal(bundle.lesson.coverage, 'partial')
  assert.equal(bundle.lesson.lessonId, 'it-a1-lesson-01')
  for (const row of rows) {
    const entry = bundle.entries.find(entry => entry.sourceRow === row.row)!
    assert.equal(entry.entryId, `it-a1-l01-${String(row.row).padStart(3, '0')}`)
    assert.equal(entry.sourceHeadword, row.word)
    assert.equal(entry.meaningFa, row.meaningFa)
    assert.equal(entry.examples.length, 3)
    const quote = entry.examples[0]
    assert.equal(quote.origin, 'quoted')
    assert.equal(quote.it, row.exampleIt)
    assert.equal(quote.fa, row.exampleFa)
    assert.equal(bundle.sourceRefs.find(ref => ref.sourceRefId === quote.sourceRefId)!.locator, row.locator)
    assert.equal(entry.cloze.sentence.replace('___', entry.cloze.acceptedAnswers[0]), entry.examples.find(example => example.exampleId === entry.cloze.exampleId)!.it)
    assert.equal(entry.writing.acceptedAnswers[0], entry.lemma)
    assert.equal(entry.enabledExercises.includes('choose-article'), hasArticle(entry))
  }
})
test('Italian article eligibility and explicit gender cannot be inferred from elision or a non-noun', () => {
  for (const mutate of [
    (copy: typeof bundle) => { copy.entries.find(entry => entry.partOfSpeech === 'verb')!.enabledExercises.push('choose-article') },
    (copy: typeof bundle) => { copy.entries.find(entry => entry.nounData?.article === "l'")!.nounData!.gender = null },
    (copy: typeof bundle) => { copy.entries[0].examples[0].sourceRefId = 'invented' },
    (copy: typeof bundle) => { copy.entries[0].cloze.sentence += ' ___' },
  ]) { const copy = structuredClone(bundle); mutate(copy); assert.ok(validateContent(copy).length > 0) }
  const unknown = bundle.entries.filter(entry => entry.partOfSpeech === 'noun' && !hasArticle(entry))
  assert.equal(unknown.length, 3)
  assert.ok(unknown.every(entry => !entry.enabledExercises.includes('choose-article')))
  assert.ok(bundle.entries.filter(entry => entry.nounData).every(entry => entry.nounData!.plural === null))
})
test('semantic case, accents and apostrophe alternatives are explicit in Italian writing targets', () => {
  const yes = bundle.entries.find(entry => entry.lemma === 'sì')!
  assert.ok(!yes.writing.acceptedAnswers.includes('si'))
  const polite = bundle.entries.find(entry => entry.lemma === 'Lei')!
  const third = bundle.entries.find(entry => entry.lemma === 'lei')!
  assert.ok(polite.writing.caseSensitive && third.writing.caseSensitive)
  assert.ok(!polite.writing.acceptedAnswers.includes('lei') && !third.writing.acceptedAnswers.includes('Lei'))
  for (const entry of bundle.entries) {
    assert.equal(new Set(entry.meaningOptionEntryIds.map(id => bundle.entries.find(other => other.entryId === id)!.meaningFa)).size, 4)
    assert.ok(entry.meaningOptionEntryIds.every(id => bundle.entries.find(other => other.entryId === id)!.introducedInLessonId === entry.introducedInLessonId))
  }
})
