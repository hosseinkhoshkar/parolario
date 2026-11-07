import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { courseBundle } from './catalog.ts'
import { lessonOneBundle } from './lesson-one.ts'
import { lessonTwoBundle } from './lesson-two.ts'
import { validateContent } from './validate.ts'
import { parseItalianSource } from '../../scripts/example-catalog.mjs'
import originalDigests from './fixtures/lesson-one-content-digests.json' with { type: 'json' }
import occurrences from './lesson-two-occurrences.json' with { type: 'json' }

test('all first-lesson content, identities, answers and examples retain their frozen pre-addition digests', () => {
  const first = courseBundle.entries.filter(entry => entry.introducedInLessonId === 'it-a1-lesson-01')
  assert.equal(first.length,85)
  for (const entry of first) {
    const { sourceRefIds, occurrences, ...core } = entry
    void sourceRefIds; void occurrences
    // Use plain Unicode key ordering, matching the original frozen digest generator.
    const normalize = (value: unknown): unknown => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key,normalize((value as Record<string,unknown>)[key])])) : value
    assert.equal(createHash('sha256').update(JSON.stringify(normalize(core))).digest('hex'),originalDigests[entry.entryId as keyof typeof originalDigests],entry.entryId)
  }
  assert.equal(Object.keys(originalDigests).length,85)
})

test('every new lesson-two row retains its meaning, exact book sample, reference, three examples and canonical cloze', () => {
  assert.deepEqual(validateContent(courseBundle),[])
  assert.deepEqual(validateContent(lessonTwoBundle),[])
  const rows = parseItalianSource(readFileSync('reference/vocabulary/italian/Lesson-02-A1.txt','utf8'),'Lesson-02-A1.txt')
  assert.equal(lessonTwoBundle.entries.length,rows.length)
  assert.ok(rows.length>=4)
  assert.equal(courseBundle.entries.length,85+rows.length)
  assert.equal(lessonTwoBundle.lesson.titleIt,'Io e gli altri')
  assert.equal(lessonTwoBundle.lesson.coverage,'partial')
  for (const row of rows) {
    const entry = lessonTwoBundle.entries.find(entry => entry.sourceRow === row.row)!
    assert.equal(entry.entryId,`it-a1-l02-${String(row.row).padStart(3,'0')}`)
    assert.equal(entry.sourceHeadword,row.word)
    assert.equal(entry.meaningFa,row.meaningFa)
    assert.equal(entry.examples[0].it,row.exampleIt)
    assert.equal(entry.examples[0].fa,row.exampleFa)
    assert.equal(entry.examples[0].origin,'quoted')
    assert.equal(lessonTwoBundle.sourceRefs.find(ref => ref.sourceRefId === entry.examples[0].sourceRefId)!.locator,row.locator)
    assert.equal(entry.examples.filter(example => example.origin === 'authored').length,2)
    assert.equal(entry.cloze.sentence.replace('___',entry.cloze.acceptedAnswers[0]),entry.examples.find(example => example.exampleId === entry.cloze.exampleId)!.it)
    assert.ok(!lessonOneBundle.entries.some(old => old.lemma.toLocaleLowerCase('it') === entry.lemma.toLocaleLowerCase('it') && old.partOfSpeech === entry.partOfSpeech),'old same-role lemma cannot be introduced again: '+entry.lemma)
  }
})

test('repeated words append references and occurrences, without a new lesson-two identity or extra introductions', () => {
  assert.ok(occurrences.length>0)
  for (const row of occurrences) {
    const entry = courseBundle.entries.find(entry => entry.entryId === row.entryId)!
    assert.ok(entry)
    assert.equal(entry.introducedInLessonId,'it-a1-lesson-01')
    const occurrence=entry.occurrences.find(item => item.lessonId === 'it-a1-lesson-02')!
    assert.ok(occurrence && occurrence.sourceRefIds.length===row.refs.length)
    for(const id of occurrence.sourceRefIds){assert.ok(entry.sourceRefIds.includes(id));assert.equal(courseBundle.sourceRefs.find(ref => ref.sourceRefId===id)!.lessonId,'it-a1-lesson-02')}
    assert.ok(!lessonTwoBundle.lesson.introducedEntryIds.includes(entry.entryId))
  }
})
