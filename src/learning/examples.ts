import type { Entry, Example, ReverseReview } from '../contracts/index.ts'

/** Completed self-assessments advance examples; reveal/render/lookup never do. */
export function getReverseExampleIndex(entry: Entry, reviews: readonly ReverseReview[]): number {
  if (entry.examples.length <= 1) return 0
  const completed = reviews.filter(review => review.entryId === entry.entryId).length
  return (completed + 1) % entry.examples.length
}
export function getReverseExample(entry: Entry, reviews: readonly ReverseReview[]): Example {
  return entry.examples[getReverseExampleIndex(entry, reviews)]
}
