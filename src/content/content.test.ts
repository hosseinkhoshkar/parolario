import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { lessonOneBundle } from './lesson-one.ts'
import { validateContent } from './validate.ts'

test('the version-two content is complete, internally consistent, and explicitly an excerpt', () => {
  assert.deepEqual(validateContent(lessonOneBundle), [])
  assert.equal(lessonOneBundle.entries.length, 20)
  assert.equal(lessonOneBundle.contentVersion, 'lesson-01-excerpt-v2')
  assert.equal(lessonOneBundle.lesson.coverage, 'partial')
  assert.equal(lessonOneBundle.provenance.reviewStatus, 'excerpt-checked')
  assert.ok(lessonOneBundle.provenance.noteFa.includes('تأیید جامع اصل کتاب نیست'))
})

test('every selected headword, Persian meaning, article and all source locators exactly match the supplied file', () => {
  const source = readFileSync(new URL('../../reference/vocabulary/Lesson-01-A1.txt', import.meta.url), 'utf8')
  const sourceEntries = [...source.matchAll(/^\d+\. (.+?) — (.+)\r?\n\s+منبع: (.+)/gm)]
  assert.equal(sourceEntries.length, 229)
  for (const entry of lessonOneBundle.entries) {
    const headword = entry.nounData ? `${entry.nounData.article} ${entry.lemma}` : entry.lemma
    const original = sourceEntries.find((match) => match[1] === headword)
    assert.ok(original, `${headword} must exist in the supplied lesson`)
    assert.equal(entry.meaningFa, original[2], headword)
    const refs = entry.sourceRefIds.map((refId) => {
      const ref = lessonOneBundle.sourceRefs.find((candidate) => candidate.sourceRefId === refId)
      assert.ok(ref)
      return ref.locator
    })
    assert.deepEqual(refs, original[3].trim().split('؛ '), `${headword}: preserve every listed source, not just the first`)
  }
})

test('canonical cloze answers reconstruct exactly the unchanged authored example', () => {
  for (const entry of lessonOneBundle.entries) {
    assert.equal(entry.examples[0].origin, 'authored')
    assert.equal(entry.cloze.sentence.split('___').length, 2)
    assert.equal(entry.cloze.sentence.replace('___', entry.cloze.acceptedAnswers[0]), entry.examples[0].de)
  }
  const named = lessonOneBundle.entries.find((entry) => entry.lemma === 'heißen')!
  assert.deepEqual(named.cloze.acceptedAnswers, ['heißen', 'heissen'])
  assert.equal(named.nounData, undefined)
  assert.equal(lessonOneBundle.entries.filter((entry) => entry.partOfSpeech === 'noun').length, 10)
})

test('writing cues distinguish base nouns without articles, infinitive verbs and complete phrases', () => {
  for (const entry of lessonOneBundle.entries) {
    assert.equal(entry.writing.promptFa, entry.meaningFa)
    assert.equal(entry.writing.acceptedAnswers[0], entry.lemma)
    assert.equal(entry.writing.caseSensitive, false)
    assert.ok(entry.writing.cueFa.length > 20)
    assert.ok(entry.enabledExercises.includes('write-word'))
    assert.equal(entry.enabledExercises.includes('choose-article'), entry.partOfSpeech === 'noun')
    if (entry.partOfSpeech === 'noun') {
      assert.ok(entry.writing.cueFa.includes('بدون آرتیکل'))
      assert.ok(entry.writing.cueFa.includes('پایه'))
      assert.ok(!entry.writing.acceptedAnswers.some((answer) => /^(der|die|das)\s/.test(answer)))
    } else {
      assert.equal(entry.nounData, undefined)
      assert.ok(!entry.enabledExercises.includes('choose-article'))
      if (entry.partOfSpeech === 'verb') assert.ok(entry.writing.cueFa.includes('مصدر'))
    }
  }
})

test('only explicitly approved keyboard variants are listed, with canonical spelling first', () => {
  const variants = lessonOneBundle.entries.filter((entry) => entry.writing.acceptedAnswers.length > 1)
  assert.deepEqual(variants.map((entry) => entry.lemma).sort(), ['Tschüss', 'heißen'].sort())
  const bye = variants.find((entry) => entry.lemma === 'Tschüss')!
  const named = variants.find((entry) => entry.lemma === 'heißen')!
  assert.deepEqual(bye.writing.acceptedAnswers, ['Tschüss', 'Tschuess'])
  assert.deepEqual(bye.cloze.acceptedAnswers, ['Tschüss', 'Tschuess'])
  assert.deepEqual(named.writing.acceptedAnswers, ['heißen', 'heissen'])
  assert.deepEqual(named.cloze.acceptedAnswers, ['heißen', 'heissen'])
  for (const entry of lessonOneBundle.entries) {
    assert.ok(!entry.writing.acceptedAnswers.includes('Tschuss'))
    assert.ok(!entry.writing.acceptedAnswers.includes('heist'))
    assert.ok(!entry.writing.acceptedAnswers.includes('heißt'))
    assert.ok(entry.writing.acceptedAnswers.every((answer) => answer === answer.normalize('NFC')))
  }
})

test('validator rejects invented alternative forms and article exercises for verbs', () => {
  const bundle = structuredClone(lessonOneBundle)
  const verb = bundle.entries.find((entry) => entry.lemma === 'heißen')!
  verb.writing.acceptedAnswers.push('heißt')
  verb.cloze.acceptedAnswers.push('heist')
  verb.enabledExercises.push('choose-article')
  const noun = bundle.entries.find((entry) => entry.lemma === 'Name')!
  noun.writing.acceptedAnswers[0] = 'der Name'
  noun.writing.cueFa = ''
  const errors = validateContent(bundle)
  assert.ok(errors.some((error) => error.includes('Invalid writing')))
  assert.ok(errors.some((error) => error.includes('Invalid cloze')))
  assert.ok(errors.some((error) => error.includes('Article exercise')))
})

test('validator rejects broken source, duplicate identity, invented noun data and invalid exercise data', () => {
  const bundle = structuredClone(lessonOneBundle)
  bundle.entries[1].entryId = bundle.entries[0].entryId
  bundle.entries[0].sourceRefIds.push('missing-source-ref')
  bundle.entries[0].nounData = { article: 'das', plural: null, pluralNote: 'unknown' }
  bundle.entries[0].meaningOptionEntryIds = [bundle.entries[0].entryId]
  bundle.entries[0].cloze.sentence = 'no blank'
  const errors = validateContent(bundle)
  assert.ok(errors.some((error) => error.includes('Duplicate entry ID')))
  assert.ok(errors.some((error) => error.includes('Broken entry source refs')))
  assert.ok(errors.some((error) => error.includes('Non-noun')))
  assert.ok(errors.some((error) => error.includes('Invalid meaning options')))
  assert.ok(errors.some((error) => error.includes('Invalid cloze')))
})

test('matching and every meaning choice use four distinct, resolvable meanings', () => {
  const byId = new Map(lessonOneBundle.entries.map((entry) => [entry.entryId, entry]))
  for (const entry of lessonOneBundle.entries) {
    assert.equal(entry.meaningOptionEntryIds.length, 4)
    assert.equal(new Set(entry.meaningOptionEntryIds.map((id) => byId.get(id)?.meaningFa)).size, 4)
    assert.ok(entry.meaningOptionEntryIds.includes(entry.entryId))
  }
  assert.equal(new Set(lessonOneBundle.entries.map((entry) => entry.meaningFa)).size, 20)
})
