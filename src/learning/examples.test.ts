import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ReverseReview } from '../contracts/index.ts'
import { lessonOneBundle } from '../testing/legacy-fixture.ts'
import { getReverseExample, getReverseExampleIndex } from './examples.ts'

const entry = { ...lessonOneBundle.entries[0], examples: [
  lessonOneBundle.entries[0].examples[0],
  { exampleId: 'additional-1', it: 'Hallo, wie geht es dir?', fa: 'سلام، حالت چطور است؟', origin: 'authored' as const },
  { exampleId: 'additional-2', it: 'Sag bitte Hallo zu Anna.', fa: 'لطفاً به آنا سلام کن.', origin: 'authored' as const },
] }
const review = (id: string, correct = true): ReverseReview => ({ reviewId: id, entryId: entry.entryId,
  sessionId: id, taskId: id, correct, at: '2026-11-02T12:00:00.000Z', studyDate: '2026-11-02' })
test('reverse examples rotate 1,2,0 by completed correct or incorrect reviews, never by render or reload', () => {
  const history: ReverseReview[] = []
  for (const index of [1, 2, 0, 1, 2, 0]) {
    const before = structuredClone(history)
    assert.equal(getReverseExampleIndex(entry, history), index)
    assert.deepEqual(getReverseExample(entry, history), entry.examples[index])
    assert.equal(getReverseExampleIndex(entry, structuredClone(history)), index)
    assert.deepEqual(history, before)
    history.push(review(`review-${history.length}`, history.length % 2 === 0))
  }
})
test('other words do not advance this word; one-example legacy content has a safe fallback', () => {
  assert.equal(getReverseExampleIndex(entry, [{ ...review('other'), entryId: 'other-word' }]), 1)
  assert.deepEqual(getReverseExample(lessonOneBundle.entries[0], []), lessonOneBundle.entries[0].examples[0])
})
