import assert from 'node:assert/strict'
import test from 'node:test'
import { courseBundle, lessonBundles, combineLessonBundles } from './catalog.ts'
import { withTextbookStudyOrder } from './textbook-study-order.ts'
import pedagogy from './italian-pedagogy.json' with { type: 'json' }

test('only one sourced Italian lesson is active; page order and verified tie-break order drive introduction', () => {
  assert.equal(lessonBundles.length, 1)
  assert.equal(courseBundle.lessons!.length, 1)
  assert.equal(courseBundle.lesson.titleIt, 'Primi contatti')
  const page = (id: string) => Number(courseBundle.sourceRefs.find(ref => ref.sourceRefId === courseBundle.entries.find(entry => entry.entryId === id)!.sourceRefIds[0])!.locator.match(/چاپی (\d+)/u)![1])
  const ids = courseBundle.lesson.introducedEntryIds
  const expected = [...courseBundle.entries].sort((a,b) => page(a.entryId)-page(b.entryId)
    || pedagogy.find(row => row.entryId === a.entryId)!.sourceOrder-pedagogy.find(row => row.entryId === b.entryId)!.sourceOrder).map(entry => entry.entryId)
  assert.deepEqual(ids, expected)
  assert.deepEqual(withTextbookStudyOrder(courseBundle), courseBundle)
  assert.ok(courseBundle.entries.every(entry => entry.entryId.startsWith('it-a1-l01-')))
})

test('registry aggregation includes entries and references from a synthetic second lesson', () => {
  const first = lessonBundles[0]
  const second = { ...first, lesson: { ...first.lesson, lessonId: 'synthetic-second', introducedEntryIds: ['synthetic-word'] },
    entries: [{ ...first.entries[0], entryId: 'synthetic-word', introducedInLessonId: 'synthetic-second' }],
    sourceRefs: [{ ...first.sourceRefs[0], sourceRefId: 'synthetic-ref', lessonId: 'synthetic-second' }] }
  const combined = combineLessonBundles([first, second])
  assert.equal(combined.lessons!.length, 2)
  assert.equal(combined.entries.length, 86)
  assert.ok(combined.entries.some(entry => entry.entryId === 'synthetic-word'))
  assert.ok(combined.sourceRefs.some(ref => ref.sourceRefId === 'synthetic-ref'))
})

test('printed page followed by Persian punctuation outranks the per-page source rank', () => {
  const original = lessonBundles[0]
  const entries = original.entries.slice(0, 2).map((entry, index) => ({ ...entry,
    sourceRefIds: ['fixture-ref-' + index], introductionOrder: index === 0 ? 1 : 99 }))
  const fixture = { ...original, entries, sourceRefs: entries.map((entry,index) => ({ sourceRefId: entry.sourceRefIds[0],
    sourceId: original.sources[0].sourceId, lessonId: original.lesson.lessonId,
    locator: `منبع مصنوعی آزمون: PDF ${index === 0 ? 149 : 6}، چاپی ${index === 0 ? 149 : 6}؛ بخش نمونه` })) }
  assert.deepEqual(withTextbookStudyOrder(fixture).lesson.introducedEntryIds, [entries[1].entryId, entries[0].entryId])
})
