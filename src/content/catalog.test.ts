import assert from 'node:assert/strict'
import test from 'node:test'
import { courseBundle, lessonBundles, combineLessonBundles } from './catalog.ts'
import { withTextbookStudyOrder } from './textbook-study-order.ts'
import pedagogy from './italian-pedagogy.json' with { type: 'json' }

test('both sourced Italian lessons retain independent page order, stable IDs and titles', () => {
  assert.equal(lessonBundles.length, 2)
  assert.equal(courseBundle.lessons!.length, 2)
  assert.deepEqual(lessonBundles.map(bundle => bundle.lesson.titleIt), ['Primi contatti', 'Io e gli altri'])
  for (const bundle of lessonBundles) {
    const page = (id: string) => Math.min(...bundle.entries.find(entry => entry.entryId === id)!.sourceRefIds.map(refId => Number(bundle.sourceRefs.find(ref => ref.sourceRefId === refId)!.locator.match(/چاپی (\d+)/u)![1])))
    const ids = bundle.lesson.introducedEntryIds
    assert.ok(ids.every((id,index) => index === 0 || page(id) >= page(ids[index-1])))
    assert.deepEqual(withTextbookStudyOrder(bundle), bundle)
    assert.ok(bundle.entries.every(entry => entry.entryId.startsWith(bundle.lesson.lessonId === 'it-a1-lesson-01' ? 'it-a1-l01-' : 'it-a1-l02-')))
  }
  const first = lessonBundles[0]
  const rank = (id: string) => pedagogy.find(row => row.entryId === id)!.sourceOrder
  assert.deepEqual(first.lesson.introducedEntryIds, [...first.entries].sort((a,b) => rank(a.entryId)-rank(b.entryId)).map(entry => entry.entryId))
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
