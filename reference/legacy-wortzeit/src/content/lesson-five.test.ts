import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { courseBundle, lessonBundles } from './catalog.ts'
import { validateContent } from './validate.ts'
import { createInitialState, transition } from '../learning/engine.ts'

const bundle = lessonBundles.find(lesson => lesson.lesson.lessonId === 'lesson-05')!

test('all 76 lesson-five source rows retain stable IDs, exact headwords, meanings, articles and every locator', () => {
  const text = readFileSync(new URL('../../reference/vocabulary/Lesson-05-A1.txt', import.meta.url), 'utf8')
  const rows = [...text.matchAll(/^(\d+)\. (.*?) — (.*?)\r?\n\s+منبع: (.*?)\r?$/gm)]
  assert.equal(rows.length, 76)
  assert.equal(bundle.entries.length, 76)
  for (const [index, entry] of bundle.entries.entries()) {
    assert.equal(entry.entryId, `a1-l05-${String(index + 1).padStart(3, '0')}`)
    assert.equal((entry.nounData ? `${entry.nounData.article} ` : '') + entry.lemma, rows[index][2])
    assert.equal(entry.meaningFa, rows[index][3])
    assert.deepEqual(entry.sourceRefIds.map(id => bundle.sourceRefs.find(ref => ref.sourceRefId === id)?.locator), rows[index][4].split('؛ '))
    assert.ok(entry.sourceRefIds.every(id => bundle.sourceRefs.find(ref => ref.sourceRefId === id)?.lessonId === 'lesson-05'))
    assert.equal(entry.introducedInLessonId, 'lesson-05')
    assert.deepEqual(entry.occurrences, [{ lessonId: 'lesson-05', sourceRefIds: entry.sourceRefIds }])
    assert.equal(entry.reviewStatus, 'excerpt-checked')
  }
  assert.equal(bundle.lesson.titleDe, 'Endlich ein Zimmer!')
  assert.equal(bundle.lesson.titleFa, 'بالاخره یک اتاق!')
  assert.equal(bundle.lesson.level, 'A1')
  assert.equal(bundle.lesson.coverage, 'partial')
  assert.equal(bundle.provenance.reviewStatus, 'excerpt-checked')
  assert.equal(bundle.provenance.file, 'reference/vocabulary/Lesson-05-A1.txt')
  assert.ok(bundle.provenance.noteFa.includes('تأیید جامع اصل کتاب نیست'))
  assert.deepEqual(validateContent(bundle), [])
})

test('lesson five introduces new cards in printed textbook page order', () => {
  const studyEntries = bundle.entries.toSorted((a, b) => a.introductionOrder - b.introductionOrder)
  const pages = studyEntries.map(entry => {
    const textbookRefs = bundle.sourceRefs.filter(ref => ref.sourceId === 'source-textbook' && entry.sourceRefIds.includes(ref.sourceRefId))
    return Math.min(...textbookRefs.map(ref => Number(ref.locator.split('چاپی ')[1])))
  })
  assert.deepEqual(pages, pages.toSorted((a, b) => a - b))
  assert.equal(pages.filter(Number.isFinite).length, 60)
  assert.deepEqual(studyEntries.slice(60).map(entry => entry.entryId),
    bundle.entries.filter(entry => !bundle.sourceRefs.some(ref => ref.sourceId === 'source-textbook' && entry.sourceRefIds.includes(ref.sourceRefId))).map(entry => entry.entryId))
  assert.deepEqual(studyEntries.map(entry => entry.entryId), bundle.lesson.introducedEntryIds)

  const now = '2026-11-06T12:00:00.000Z'
  const selected = transition(createInitialState(courseBundle, 'Europe/Berlin'), { type: 'select-lesson', lessonId: 'lesson-05' }, courseBundle, now)
  const started = transition(selected, { type: 'start-session', sessionId: 'lesson-five-page-order', seed: 1 }, courseBundle, now)
  assert.deepEqual(studyEntries.slice(0, 5).map(entry => entry.lemma), ['Es geht', 'Internet', 'Vermieter', 'abholen', 'ausziehen'])
  assert.deepEqual(started.session!.queue.filter(task => task.kind === 'flashcard').map(task => task.entryId),
    studyEntries.slice(0, 5).map(entry => entry.entryId))
})

test('each lesson-five entry has its original bilingual cloze example and two unchanged sidecar examples', () => {
  const sidecar = JSON.parse(readFileSync(new URL('../../public/content/examples/Lesson-05-A1.json', import.meta.url), 'utf8'))
  for (const [index, original] of bundle.entries.entries()) {
    const entry = courseBundle.entries.find(entry => entry.entryId === original.entryId)!
    assert.equal(original.examples.length, 1)
    assert.equal(entry.examples.length, 3)
    assert.deepEqual(entry.examples[0], original.examples[0])
    assert.equal(new Set(entry.examples.map(example => example.de.normalize('NFC').toLowerCase())).size, 3)
    assert.equal(new Set(entry.examples.map(example => example.fa)).size, 3)
    assert.deepEqual(entry.examples.slice(1), sidecar.entries[index].additionalExamples.map((example: object, i: number) => ({ exampleId: `${entry.entryId}-additional-${i + 1}`, ...example })))
    for (const example of entry.examples) {
      assert.equal(example.origin, 'authored')
      assert.match(example.fa, /[\u0600-\u06ff]/u)
      assert.ok(example.de.length > 8 && example.fa.length > 8)
    }
    assert.equal(entry.cloze.sentence.split('___').length, 2)
    assert.equal(entry.cloze.sentence.replace('___', entry.cloze.acceptedAnswers[0]), entry.examples[0].de)
    assert.equal(entry.cloze.translationFa, entry.examples[0].fa)
    assert.equal(entry.writing.promptFa, entry.meaningFa)
    assert.equal(entry.writing.acceptedAnswers[0], entry.lemma)
    assert.deepEqual(entry.cloze.acceptedAnswers, entry.writing.acceptedAnswers)
    assert.ok(entry.writing.cueFa.length > 20)
    assert.ok(!entry.writing.cueFa.includes(entry.lemma))
  }
})

test('article exercises require a source noun and known article; plural Möbel stays explicitly plural', () => {
  assert.equal(bundle.entries.filter(entry => entry.nounData).length, 38)
  for (const entry of bundle.entries) {
    assert.deepEqual(entry.enabledExercises, ['flashcard', 'choose-meaning', 'cloze', 'match', 'write-word', ...(entry.nounData ? ['choose-article'] : [])])
    assert.equal(entry.partOfSpeech === 'noun', Boolean(entry.nounData))
    if (entry.nounData) {
      assert.equal(entry.nounData.plural, null)
      assert.ok(entry.nounData.pluralNote)
      assert.ok(entry.writing.cueFa.includes('بدون آرتیکل'))
    }
    if (entry.partOfSpeech === 'verb') assert.ok(entry.writing.cueFa.includes('مصدر'))
  }
  const furniture = bundle.entries.find(entry => entry.lemma === 'Möbel')!
  assert.equal(furniture.nounData?.article, 'die')
  assert.ok(furniture.nounData?.pluralNote.includes('جمع'))
  assert.ok(furniture.writing.cueFa.includes('صورت جمع'))
  assert.ok(bundle.entries.find(entry => entry.lemma === 'Bad')!.writing.cueFa.includes('سه‌حرفی'))
  assert.ok(bundle.entries.find(entry => entry.lemma === 'Badezimmer')!.writing.cueFa.includes('مرکب'))
})

test('meaning choices stay in lesson five with distinct meanings and no overlapping bathroom or fetching distractors', () => {
  const byId = new Map(bundle.entries.map(entry => [entry.entryId, entry]))
  const groups = [['Bad', 'Badezimmer'], ['abholen', 'holen', 'bringen', 'mitbringen']]
  for (const entry of bundle.entries) {
    const options = entry.meaningOptionEntryIds.map(id => byId.get(id)!)
    assert.ok(options.every(Boolean))
    assert.equal(options.length, 4)
    assert.ok(options.includes(entry))
    assert.equal(new Set(options.map(option => option.entryId)).size, 4)
    assert.equal(new Set(options.map(option => option.meaningFa)).size, 4)
    const excluded = groups.find(group => group.includes(entry.lemma)) ?? []
    assert.ok(options.every(option => option === entry || !excluded.includes(option.lemma)))
  }
})

test('lesson-five keyboard alternatives are explicit and preserve German spelling', () => {
  const ascii = (value: string) => value.replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue').replaceAll('Ü', 'Ue').replaceAll('ß', 'ss')
  for (const entry of bundle.entries) {
    assert.equal(new Set(entry.writing.acceptedAnswers).size, entry.writing.acceptedAnswers.length)
    for (const variant of entry.writing.acceptedAnswers.slice(1)) assert.equal(ascii(variant), ascii(entry.lemma))
  }
  assert.deepEqual(bundle.entries.find(entry => entry.lemma === 'Größe')?.writing.acceptedAnswers, ['Größe', 'Groesse', 'Grösse'])
  assert.deepEqual(bundle.entries.find(entry => entry.lemma === 'Überraschung')?.writing.acceptedAnswers, ['Überraschung', 'Ueberraschung'])
  assert.deepEqual(bundle.entries.find(entry => entry.lemma === 'Wohngemeinschaft')?.writing.acceptedAnswers, ['Wohngemeinschaft'])
})
