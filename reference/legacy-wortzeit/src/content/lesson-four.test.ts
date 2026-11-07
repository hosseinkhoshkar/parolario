import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { lessonFourBundle } from './lesson-four.ts'
import { lessonOneBundle } from './lesson-one.ts'
import { validateContent } from './validate.ts'

test('lesson four contains every one of the 84 supplied headwords, meanings, articles and source locators', () => {
  const text = readFileSync(new URL('../../reference/vocabulary/Lesson-04-A1.txt', import.meta.url), 'utf8')
  const originals = [...text.matchAll(/^(\d+)\. (.*?) — (.*?)\r?\n\s+منبع: (.*?)\r?$/gm)]
  assert.equal(originals.length, 84)
  assert.equal(lessonFourBundle.entries.length, originals.length)
  assert.equal(new Set(lessonFourBundle.entries.map(entry => entry.entryId)).size, 84)
  for (const [index, entry] of lessonFourBundle.entries.entries()) {
    const original = originals[index]
    const headword = entry.nounData ? `${entry.nounData.article} ${entry.lemma}` : entry.lemma
    assert.equal(entry.entryId, `a1-l04-${String(index + 1).padStart(3, '0')}`)
    assert.equal(headword, original[2])
    assert.equal(entry.meaningFa, original[3])
    assert.deepEqual(entry.sourceRefIds.map(id => lessonFourBundle.sourceRefs.find(ref => ref.sourceRefId === id)?.locator), original[4].split('؛ '))
    assert.equal(entry.introducedInLessonId, lessonFourBundle.lesson.lessonId)
    assert.equal(entry.reviewStatus, 'excerpt-checked')
  }
  assert.equal(lessonFourBundle.lesson.titleDe, 'Spiel und Spaß')
  assert.equal(lessonFourBundle.provenance.file, 'reference/vocabulary/Lesson-04-A1.txt')
  assert.equal(lessonFourBundle.lesson.coverage, 'partial')
  assert.ok(lessonFourBundle.provenance.noteFa.includes('تأیید جامع اصل کتاب نیست'))
})

test('all lesson-four clozes reconstruct authored German examples with their canonical base answer', () => {
  for (const entry of lessonFourBundle.entries) {
    assert.equal(entry.examples.length, 1)
    assert.equal(entry.examples[0].origin, 'authored')
    assert.ok(entry.examples[0].fa.length > 8)
    assert.equal(entry.cloze.sentence.split('___').length, 2)
    assert.equal(entry.cloze.acceptedAnswers[0], entry.lemma)
    assert.equal(entry.cloze.sentence.replace('___', entry.cloze.acceptedAnswers[0]), entry.examples[0].de)
    assert.equal(entry.cloze.translationFa, entry.examples[0].fa)
    assert.equal(entry.writing.promptFa, entry.meaningFa)
    assert.equal(entry.writing.acceptedAnswers[0], entry.lemma)
    assert.ok(entry.writing.cueFa.length > 20)
    assert.equal(entry.writing.cueFa.includes(entry.lemma), false, `${entry.lemma}: cue must not reveal the German answer`)
  }
})

test('only source nouns receive known articles; German language names do not gain invented article data', () => {
  const text = readFileSync(new URL('../../reference/vocabulary/Lesson-04-A1.txt', import.meta.url), 'utf8')
  const sourceNouns = [...text.matchAll(/^\d+\. (der|die|das) (.+?) — /gm)]
  assert.equal(lessonFourBundle.entries.filter(entry => entry.nounData).length, sourceNouns.length)
  for (const entry of lessonFourBundle.entries) {
    assert.equal(entry.enabledExercises.includes('choose-article'), Boolean(entry.nounData))
    if (entry.nounData) {
      assert.equal(entry.partOfSpeech, 'noun')
      assert.equal(entry.nounData.plural, null)
      assert.ok(entry.nounData.pluralNote)
      assert.ok(entry.writing.cueFa.includes('بدون آرتیکل'))
    } else {
      assert.notEqual(entry.partOfSpeech, 'noun')
      if (entry.partOfSpeech === 'verb') assert.ok(entry.writing.cueFa.includes('مصدر'))
    }
  }
  assert.equal(lessonFourBundle.entries.find(entry => entry.lemma === 'Italienisch')?.nounData, undefined)
})

test('meaning options are four distinct lesson-four entries and avoid interchangeable exam nouns', () => {
  const byId = new Map(lessonFourBundle.entries.map(entry => [entry.entryId, entry]))
  for (const entry of lessonFourBundle.entries) {
    assert.equal(entry.meaningOptionEntryIds.length, 4)
    assert.ok(entry.meaningOptionEntryIds.includes(entry.entryId))
    assert.equal(new Set(entry.meaningOptionEntryIds).size, 4)
    assert.equal(new Set(entry.meaningOptionEntryIds.map(id => byId.get(id)?.meaningFa)).size, 4)
    assert.ok(entry.meaningOptionEntryIds.every(id => byId.has(id)))
  }
  const exam = lessonFourBundle.entries.find(entry => entry.lemma === 'Prüfung')!
  const testWord = lessonFourBundle.entries.find(entry => entry.lemma === 'Test')!
  assert.equal(exam.meaningOptionEntryIds.includes(testWord.entryId), false)
  assert.equal(testWord.meaningOptionEntryIds.includes(exam.entryId), false)
})

test('arm and Arm retain separate meanings, IDs and case-sensitive writing; new IDs do not collide with lesson one', () => {
  const poor = lessonFourBundle.entries.find(entry => entry.lemma === 'arm')!
  const body = lessonFourBundle.entries.find(entry => entry.lemma === 'Arm')!
  assert.notEqual(poor.entryId, body.entryId)
  assert.equal(poor.partOfSpeech, 'adjective')
  assert.equal(body.nounData?.article, 'der')
  assert.equal(poor.writing.caseSensitive, true)
  assert.equal(body.writing.caseSensitive, true)
  assert.equal(poor.writing.acceptedAnswers.includes('Arm'), false)
  assert.equal(body.writing.acceptedAnswers.includes('arm'), false)
  const firstIds = new Set(lessonOneBundle.entries.map(entry => entry.entryId))
  assert.equal(lessonFourBundle.entries.some(entry => firstIds.has(entry.entryId)), false)
})

test('lesson-four keyboard alternatives preserve German letters rather than permitting close spellings', () => {
  const ascii = (value: string) => value.replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue').replaceAll('Ä', 'Ae').replaceAll('Ö', 'Oe').replaceAll('Ü', 'Ue').replaceAll('ß', 'ss')
  for (const entry of lessonFourBundle.entries) {
    assert.deepEqual(entry.writing.acceptedAnswers, entry.cloze.acceptedAnswers)
    assert.equal(new Set(entry.writing.acceptedAnswers).size, entry.writing.acceptedAnswers.length)
    for (const variant of entry.writing.acceptedAnswers.slice(1)) assert.equal(ascii(variant), ascii(entry.lemma))
  }
  assert.deepEqual(lessonFourBundle.entries.find(entry => entry.lemma === 'dürfen')?.writing.acceptedAnswers, ['dürfen', 'duerfen'])
  assert.deepEqual(lessonFourBundle.entries.find(entry => entry.lemma === 'weiß')?.writing.acceptedAnswers, ['weiß', 'weiss'])
})

test('the complete lesson-four learning bundle passes shared content validation', () => {
  assert.deepEqual(validateContent(lessonFourBundle), [])
})
